import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendToQueue, flushQueue, queueLength, readState, withLock } from '../ember-hook.mjs';
import { tmpDir, startServer, KEY } from './helpers.mjs';

const hb = (i) => ({ time: 1700000000 + i, project: 'p', editor: 'codex', category: 'ai' });

test('append then flush (202) empties the queue and sends auth + body', async (t) => {
  const server = await startServer(({ body }) => [202, { accepted: body.heartbeats.length, duplicates: 0 }]);
  t.after(server.close);
  const home = tmpDir();
  for (let i = 0; i < 3; i++) appendToQueue(home, hb(i));
  assert.equal(queueLength(home), 3);

  const res = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(res.status, 'ok');
  assert.equal(res.sent, 3);
  assert.equal(queueLength(home), 0);
  assert.equal(server.requests.length, 1);
  const [req] = server.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/api/v1/heartbeats');
  assert.equal(req.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(req.body.heartbeats.map((h) => h.time), [1700000000, 1700000001, 1700000002]);
  assert.ok(!fs.existsSync(path.join(home, 'queue.inflight.jsonl')));
});

test('large queues are sent in batches of at most 500', async (t) => {
  const server = await startServer(() => [202, { accepted: 0, duplicates: 0 }]);
  t.after(server.close);
  const home = tmpDir();
  fs.writeFileSync(path.join(home, 'queue.jsonl'), Array.from({ length: 1201 }, (_, i) => JSON.stringify(hb(i))).join('\n') + '\n');
  const res = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(res.sent, 1201);
  assert.deepEqual(server.requests.map((r) => r.body.heartbeats.length), [500, 500, 201]);
  assert.equal(queueLength(home), 0);
});

test('500 keeps the queue and sets a backoff; forced retry later succeeds', async (t) => {
  let fail = true;
  const server = await startServer(() => (fail ? [500, { error: 'boom' }] : [202, { accepted: 1, duplicates: 0 }]));
  t.after(server.close);
  const home = tmpDir();
  appendToQueue(home, hb(1));
  appendToQueue(home, hb(2));

  const res = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(res.status, 'retry');
  assert.equal(queueLength(home), 2);
  const state = readState(home);
  assert.equal(state.backoff.failures, 1);
  assert.ok(state.backoff.next_at > Date.now() + 25_000);

  // Within the backoff window nothing is sent.
  const skipped = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(skipped.status, 'skipped');
  assert.equal(server.requests.length, 1);

  fail = false;
  const ok = await flushQueue(home, { apiUrl: server.url, apiKey: KEY, force: true });
  assert.equal(ok.status, 'ok');
  assert.equal(queueLength(home), 0);
  assert.equal(readState(home).backoff, undefined);
  // order preserved
  assert.deepEqual(server.requests[1].body.heartbeats.map((h) => h.time), [1700000001, 1700000002]);
});

test('401 writes last_error and keeps the queue', async (t) => {
  const server = await startServer(() => [401, { error: 'unauthorized' }]);
  t.after(server.close);
  const home = tmpDir();
  appendToQueue(home, hb(1));
  const res = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(res.status, 'unauthorized');
  assert.equal(queueLength(home), 1);
  assert.match(fs.readFileSync(path.join(home, 'last_error'), 'utf8'), /401/);
});

test('400 drops the invalid batch (no retry)', async (t) => {
  const server = await startServer(() => [400, { error: 'invalid' }]);
  t.after(server.close);
  const home = tmpDir();
  appendToQueue(home, hb(1));
  fs.appendFileSync(path.join(home, 'queue.jsonl'), 'this is not json\n');
  const res = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(res.dropped, 2); // the 400'd heartbeat + the corrupt line
  assert.equal(queueLength(home), 0);
});

test('network error keeps the queue', async () => {
  const home = tmpDir();
  appendToQueue(home, hb(1));
  const res = await flushQueue(home, { apiUrl: 'http://127.0.0.1:9', apiKey: KEY });
  assert.equal(res.status, 'retry');
  assert.equal(queueLength(home), 1);
});

test('missing API key keeps the queue and records why', async () => {
  const home = tmpDir();
  appendToQueue(home, hb(1));
  const res = await flushQueue(home, { apiUrl: 'http://127.0.0.1:9', apiKey: '' });
  assert.equal(res.status, 'no-key');
  assert.equal(queueLength(home), 1);
  assert.match(fs.readFileSync(path.join(home, 'last_error'), 'utf8'), /no API key/);
});

test('concurrent flushes never double-send; appends during a flush are kept', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const server = await startServer(() => [202, { accepted: 0, duplicates: 0 }]);
  t.after(server.close);
  const home = tmpDir();
  appendToQueue(home, hb(1));

  // Slow down the first request by wrapping fetch.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    await gate;
    return realFetch(...args);
  };
  t.after(() => (globalThis.fetch = realFetch));

  const first = flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  await new Promise((r) => setImmediate(r));
  appendToQueue(home, hb(2)); // arrives while the first flush is in flight
  const second = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'busy');

  release();
  const r1 = await first;
  assert.equal(r1.sent, 1);
  assert.equal(queueLength(home), 1, 'heartbeat appended mid-flush is still queued');

  const r3 = await flushQueue(home, { apiUrl: server.url, apiKey: KEY });
  assert.equal(r3.sent, 1);
  const times = server.requests.flatMap((r) => r.body.heartbeats.map((h) => h.time));
  assert.deepEqual(times, [1700000001, 1700000002]);
});

test('stale lock (>10s) is broken; queue is capped at 20k lines', () => {
  const home = tmpDir();
  const lock = path.join(home, 'queue.lock');
  fs.writeFileSync(lock, '999999 0');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  let ran = false;
  withLock(home, (locked) => {
    ran = locked;
  });
  assert.equal(ran, true);
  assert.ok(!fs.existsSync(lock));

  const big = Array.from({ length: 20_005 }, (_, i) => JSON.stringify(hb(i))).join('\n') + '\n';
  fs.writeFileSync(path.join(home, 'queue.jsonl'), big);
  appendToQueue(home, hb(99_999));
  const lines = fs.readFileSync(path.join(home, 'queue.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 20_000);
  assert.equal(JSON.parse(lines.at(-1)).time, 1700099999, 'newest kept, oldest dropped');
});
