// Heartbeat queue: in-memory buffer + persisted backlog with exponential backoff.
// Free of `vscode` imports so it can be unit-tested; the extension backs the
// store with context.globalState.
import type { Heartbeat, SendResult } from './types';

export interface QueueStore {
  get(): Heartbeat[];
  set(items: Heartbeat[]): PromiseLike<void>;
}

export type Sender = (batch: Heartbeat[]) => Promise<SendResult>;

export interface FlushResult {
  status: 'ok' | 'empty' | 'skipped' | 'unauthorized' | 'retry';
  sent: number;
  accepted: number;
  duplicates: number;
  dropped: number;
  pending: number;
  error?: string;
}

export interface QueueOptions {
  cap?: number;
  batchSize?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export class HeartbeatQueue {
  private memory: Heartbeat[] = [];
  private failures = 0;
  private nextRetryAt = 0;
  private inFlight: Promise<FlushResult> | undefined;
  /** Set after a 401; nothing is sent until resetAuth() (e.g. a new key). */
  authBlocked = false;

  private readonly cap: number;
  private readonly batchSize: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly store: QueueStore,
    opts: QueueOptions = {},
  ) {
    this.cap = opts.cap ?? 5000;
    this.batchSize = opts.batchSize ?? 500;
    this.minBackoffMs = opts.minBackoffMs ?? 30_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10 * 60_000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => undefined);
  }

  enqueue(hb: Heartbeat): void {
    this.memory.push(hb);
    if (this.memory.length > this.cap) this.memory.splice(0, this.memory.length - this.cap);
  }

  get pending(): number {
    return this.memory.length + this.store.get().length;
  }

  /** Epoch ms before which non-forced flushes are skipped (0 = no backoff). */
  get retryAt(): number {
    return this.nextRetryAt;
  }

  resetAuth(): void {
    this.authBlocked = false;
    this.failures = 0;
    this.nextRetryAt = 0;
  }

  /** Move in-memory heartbeats to the persistent store (oldest dropped beyond the cap). */
  async persist(): Promise<void> {
    if (!this.memory.length) return;
    const items = this.capped(this.store.get().concat(this.memory));
    this.memory = [];
    await this.store.set(items);
  }

  /** Send everything queued. Concurrent calls share one in-flight flush. */
  flush(send: Sender, { force = false } = {}): Promise<FlushResult> {
    if (!this.inFlight) {
      this.inFlight = this.doFlush(send, force).finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private capped(items: Heartbeat[]): Heartbeat[] {
    return items.length > this.cap ? items.slice(items.length - this.cap) : items;
  }

  private async doFlush(send: Sender, force: boolean): Promise<FlushResult> {
    const result: FlushResult = { status: 'ok', sent: 0, accepted: 0, duplicates: 0, dropped: 0, pending: 0 };

    if (this.authBlocked || (!force && this.now() < this.nextRetryAt)) {
      await this.persist();
      return { ...result, status: this.authBlocked ? 'unauthorized' : 'skipped', pending: this.pending };
    }

    const stored = this.store.get();
    const items = stored.concat(this.memory);
    this.memory = [];
    if (!items.length) return { ...result, status: 'empty' };

    let i = 0;
    while (i < items.length) {
      const batch = items.slice(i, i + this.batchSize);
      let res: SendResult;
      try {
        res = await send(batch);
      } catch (e) {
        res = { kind: 'retry', status: 0, message: String(e) };
      }
      if (res.kind === 'ok') {
        result.sent += batch.length;
        result.accepted += res.accepted;
        result.duplicates += res.duplicates;
      } else if (res.kind === 'invalid') {
        result.dropped += batch.length;
        this.log(`server rejected ${batch.length} heartbeats (400): ${res.message}`);
      } else if (res.kind === 'unauthorized') {
        this.authBlocked = true;
        result.status = 'unauthorized';
        result.error = 'API key rejected (401)';
        break;
      } else {
        this.failures++;
        const delay = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** (this.failures - 1));
        this.nextRetryAt = this.now() + delay;
        result.status = 'retry';
        result.error = res.status ? `HTTP ${res.status}: ${res.message}` : res.message;
        this.log(`flush failed (${result.error}); retrying in ${Math.round(delay / 1000)}s`);
        break;
      }
      i += batch.length;
    }

    if (result.status === 'ok') {
      this.failures = 0;
      this.nextRetryAt = 0;
    }

    const remaining = this.capped(items.slice(i));
    if (remaining.length || stored.length) await this.store.set(remaining);
    result.pending = this.pending;
    return result;
  }
}
