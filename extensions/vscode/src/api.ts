// Minimal Ember HTTP client (global fetch: Node 18+ in every supported editor).
import type { Heartbeat, SendResult, Today } from './types';

const SEND_TIMEOUT_MS = 15_000;
const TODAY_TIMEOUT_MS = 10_000;

export class UnauthorizedError extends Error {
  constructor() {
    super('API key rejected (401)');
  }
}

export class EmberClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly userAgent: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };
  }

  /** POST a batch (<= 500). Never throws: failures are mapped onto SendResult. */
  async sendHeartbeats(heartbeats: Heartbeat[]): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}/api/v1/heartbeats`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ heartbeats }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (e) {
      return { kind: 'retry', status: 0, message: errorMessage(e) };
    }
    const text = await res.text().catch(() => '');
    if (res.status >= 200 && res.status < 300) {
      const body = safeJson(text) as { accepted?: number; duplicates?: number } | undefined;
      return { kind: 'ok', accepted: body?.accepted ?? heartbeats.length, duplicates: body?.duplicates ?? 0 };
    }
    if (res.status === 400) return { kind: 'invalid', status: 400, message: text.slice(0, 300) };
    if (res.status === 401) return { kind: 'unauthorized' };
    return { kind: 'retry', status: res.status, message: text.slice(0, 300) || res.statusText };
  }

  /** GET /api/v1/me/today. Throws UnauthorizedError on 401, Error otherwise. */
  async today(): Promise<Today> {
    const res = await fetch(`${this.apiUrl}/api/v1/me/today`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(TODAY_TIMEOUT_MS),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Partial<Today>;
    return { seconds: Number(body.seconds) || 0, text: String(body.text ?? ''), username: String(body.username ?? '') };
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'request timed out';
    const cause = (e as { cause?: { code?: string } }).cause;
    return cause?.code ? `${e.message} (${cause.code})` : e.message;
  }
  return String(e);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
