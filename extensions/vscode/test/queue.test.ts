import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { HeartbeatQueue, type QueueStore } from '../src/queue';
import { EmberClient } from '../src/api';
import type { Heartbeat, SendResult } from '../src/types';

const hb = (i: number): Heartbeat => ({ time: 1_700_000_000 + i, project: 'p', editor: 'vscode', category: 'coding' });

function memoryStore(initial: Heartbeat[] = []): QueueStore & { items: Heartbeat[]; writes: number } {
  const s = {
    items: initial,
    writes: 0,
    get: () => s.items,
    set: async (items: Heartbeat[]) => {
      s.items = items;
      s.writes++;
    },
  };
  return s;
}

const ok = async (b: Heartbeat[]): Promise<SendResult> => ({ kind: 'ok', accepted: b.length, duplicates: 0 });

test('flush sends memory + persisted backlog in batches of 500, oldest first', async () => {
  const store = memoryStore([hb(0), hb(1)]);
  const q = new HeartbeatQueue(store);
  for (let i = 2; i < 1203; i++) q.enqueue(hb(i));
  const sizes: number[] = [];
  const firstTimes: number[] = [];
  const r = await q.flush(async (b) => {
    sizes.push(b.length);
    firstTimes.push(b[0].time);
    return ok(b);
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.sent, 1203);
  assert.deepEqual(sizes, [500, 500, 203]);
  assert.equal(firstTimes[0], 1_700_000_000);
  assert.equal(q.pending, 0);
  assert.deepEqual(store.items, []);
});

test('retryable failure persists everything and backs off 30s -> 60s -> ... -> 10 min', async () => {
  let now = 1_000_000;
  const store = memoryStore();
  const q = new HeartbeatQueue(store, { now: () => now });
  q.enqueue(hb(1));
  const fail = async (): Promise<SendResult> => ({ kind: 'retry', status: 503, message: 'down' });

  const delays: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await q.flush(fail, { force: true });
    assert.equal(r.status, 'retry');
    delays.push((q.retryAt - now) / 1000);
  }
  assert.deepEqual(delays, [30, 60, 120, 240, 480, 600, 600]);
  assert.equal(store.items.length, 1, 'persisted to the store');

  // Non-forced flush inside the window is skipped, but new heartbeats are persisted.
  q.enqueue(hb(2));
  let calls = 0;
  const skipped = await q.flush(async (b) => (calls++, ok(b)));
  assert.equal(skipped.status, 'skipped');
  assert.equal(calls, 0);
  assert.equal(store.items.length, 2);

  now = q.retryAt;
  const r = await q.flush(ok);
  assert.equal(r.status, 'ok');
  assert.equal(r.sent, 2);
  assert.equal(q.retryAt, 0, 'backoff reset after success');
});

test('401 blocks sending until resetAuth; 400 drops the batch', async () => {
  const store = memoryStore();
  const q = new HeartbeatQueue(store);
  q.enqueue(hb(1));
  const r = await q.flush(async () => ({ kind: 'unauthorized' }));
  assert.equal(r.status, 'unauthorized');
  assert.equal(q.authBlocked, true);
  assert.equal(store.items.length, 1);

  let calls = 0;
  assert.equal((await q.flush(async (b) => (calls++, ok(b)), { force: true })).status, 'unauthorized');
  assert.equal(calls, 0);

  q.resetAuth();
  const dropped = await q.flush(async () => ({ kind: 'invalid', status: 400, message: 'bad' }));
  assert.equal(dropped.status, 'ok');
  assert.equal(dropped.dropped, 1);
  assert.equal(q.pending, 0);
});

test('store is capped at 5000, dropping the oldest', async () => {
  const store = memoryStore();
  const q = new HeartbeatQueue(store);
  for (let i = 0; i < 5100; i++) q.enqueue(hb(i));
  await q.persist();
  assert.equal(store.items.length, 5000);
  assert.equal(store.items[0].time, 1_700_000_100);
  for (let i = 0; i < 10; i++) q.enqueue(hb(10_000 + i));
  await q.flush(async () => ({ kind: 'retry', status: 0, message: 'offline' }));
  assert.equal(store.items.length, 5000);
  assert.equal(store.items.at(-1)?.time, 1_700_010_009);
});

test('sender exceptions are treated as retryable; concurrent flushes share one run', async () => {
  const q = new HeartbeatQueue(memoryStore());
  q.enqueue(hb(1));
  const r = await q.flush(async () => {
    throw new Error('boom');
  });
  assert.equal(r.status, 'retry');

  let calls = 0;
  const slow = async (b: Heartbeat[]) => {
    calls++;
    await new Promise((res) => setTimeout(res, 20));
    return ok(b);
  };
  const [a, b] = await Promise.all([q.flush(slow, { force: true }), q.flush(slow, { force: true })]);
  assert.equal(calls, 1);
  assert.strictEqual(a, b);
});

test('EmberClient maps HTTP statuses onto SendResult against a local server', async (t) => {
  let status = 202;
  const seen: { auth?: string; body: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization, body: data ? JSON.parse(data) : undefined });
      res.writeHead(req.url === '/api/v1/me/today' ? 200 : status, { 'Content-Type': 'application/json' });
      res.end(
        req.url === '/api/v1/me/today'
          ? JSON.stringify({ seconds: 8040, text: '2h 14m', username: 'dev' })
          : JSON.stringify({ accepted: 1, duplicates: 2 }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new EmberClient(url, 'ember_k', 'test');

  assert.deepEqual(await client.sendHeartbeats([hb(1)]), { kind: 'ok', accepted: 1, duplicates: 2 });
  assert.equal(seen[0].auth, 'Bearer ember_k');
  assert.deepEqual(seen[0].body, { heartbeats: [hb(1)] });
  status = 400;
  assert.equal((await client.sendHeartbeats([hb(1)])).kind, 'invalid');
  status = 401;
  assert.equal((await client.sendHeartbeats([hb(1)])).kind, 'unauthorized');
  status = 429;
  assert.equal((await client.sendHeartbeats([hb(1)])).kind, 'retry');
  status = 500;
  assert.equal((await client.sendHeartbeats([hb(1)])).kind, 'retry');
  assert.deepEqual(await client.today(), { seconds: 8040, text: '2h 14m', username: 'dev' });

  const offline = new EmberClient('http://127.0.0.1:9', 'k', 'test');
  assert.equal((await offline.sendHeartbeats([hb(1)])).kind, 'retry');
});
