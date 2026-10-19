// Token usage read from Claude Code and Codex transcripts: counted once, numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanModel, collectUsage, readNewLines, requestBody, tallyUsage } from '../ember-hook.mjs';
import { tmpDir, makeRepo, startServer, isolatedEnv, KEY } from './helpers.mjs';

const HOOK = fileURLToPath(new URL('../ember-hook.mjs', import.meta.url));
const KEY_HEX = 'ab'.repeat(32);

/** One Claude Code transcript line: an assistant content block carrying its message's usage. */
const claude = (id, model, usage, text = 'SECRET_TEXT') => JSON.stringify({
  type: 'assistant',
  requestId: `req_${id}`,
  message: {
    id, model, role: 'assistant', content: [{ type: 'text', text }],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
  },
});
const codexTurn = (model) => JSON.stringify({ type: 'turn_context', payload: { model, cwd: '/SECRET/path' } });
const codexTotals = (t) => JSON.stringify({
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, ...t } } },
});

test('claude: content blocks of one message are counted once', () => {
  const lines = [
    claude('msg_1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 }),
    claude('msg_1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 }),
    claude('msg_2', 'claude-opus-5-5', { input_tokens: 5, output_tokens: 7 }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'SECRET_PROMPT' } }),
    'not json',
  ];
  const { usage } = tallyUsage(lines);
  assert.deepEqual(usage, [{ model: 'claude-opus-5-5', input: 15, output: 57, cache_read: 1000, cache_write: 200 }]);
});

test('claude: a message split across two runs is not double counted', () => {
  const first = tallyUsage([claude('msg_1', 'claude-sonnet-5-5', { input_tokens: 3, output_tokens: 10 })]);
  // The next run sees the same message again, now with its final output count, then a new one.
  const second = tallyUsage([
    claude('msg_1', 'claude-sonnet-5-5', { input_tokens: 3, output_tokens: 40 }),
    claude('msg_2', 'claude-sonnet-5-5', { input_tokens: 1, output_tokens: 1 }),
  ], first.carry);
  assert.deepEqual(first.usage[0], { model: 'claude-sonnet-5-5', input: 3, output: 10, cache_read: 0, cache_write: 0 });
  assert.deepEqual(second.usage[0], { model: 'claude-sonnet-5-5', input: 1, output: 31, cache_read: 0, cache_write: 0 });
});

test('claude: synthetic and malformed models are skipped, models are kept apart', () => {
  const { usage } = tallyUsage([
    claude('a', '<synthetic>', { output_tokens: 9 }),
    claude('b', 'Claude-Haiku-5-5', { output_tokens: 2 }),
    claude('c', 'claude-opus-5-5', { output_tokens: 3 }),
    claude('d', 'rm -rf /', { output_tokens: 4 }),
  ]);
  assert.deepEqual(usage.map((u) => [u.model, u.output]), [['claude-haiku-5-5', 2], ['claude-opus-5-5', 3]]);
  assert.equal(cleanModel('/Users/me/model'), undefined);
  assert.equal(cleanModel('gpt-5.3-codex'), 'gpt-5.3-codex');
});

test('codex: running totals become deltas, cached input is split out', () => {
  const first = tallyUsage([
    codexTurn('gpt-6-luna'),
    codexTotals({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }),
    codexTotals({ input_tokens: 2500, cached_input_tokens: 900, output_tokens: 150 }),
  ]);
  assert.deepEqual(first.usage, [{ model: 'gpt-6-luna', input: 1600, output: 150, cache_read: 900, cache_write: 0 }]);
  const second = tallyUsage([codexTotals({ input_tokens: 3000, cached_input_tokens: 1000, output_tokens: 200 })], first.carry);
  assert.deepEqual(second.usage, [{ model: 'gpt-6-luna', input: 400, output: 50, cache_read: 100, cache_write: 0 }]);
});

test('readNewLines returns only complete lines and resumes where it stopped', () => {
  const file = path.join(tmpDir(), 't.jsonl');
  fs.writeFileSync(file, 'one\ntwo\nthr');
  const a = readNewLines(file, 0);
  assert.deepEqual(a.lines, ['one', 'two']);
  fs.appendFileSync(file, 'ee\n');
  const b = readNewLines(file, a.offset);
  assert.deepEqual(b.lines, ['three']);
  assert.equal(readNewLines(file, b.offset).lines.length, 0);
  // Replaced by a shorter file: start over.
  fs.writeFileSync(file, 'x\n');
  assert.deepEqual(readNewLines(file, b.offset), { lines: ['x'], offset: 2, restarted: true });
  assert.equal(readNewLines(path.join(path.dirname(file), 'missing.jsonl'), 0), null);
});

test('collectUsage reads each part of a transcript once and ids are stable per position', () => {
  const file = path.join(tmpDir(), 'session.jsonl');
  fs.writeFileSync(file, `${claude('m1', 'claude-opus-5-5', { input_tokens: 4, output_tokens: 6 })}\n`);
  const state = {};
  const opts = { agent: 'claude-code', now: 1_800_000_000, entityKey: KEY_HEX };
  const [r1] = collectUsage(state, { transcript_path: file }, opts);
  assert.deepEqual(Object.keys(r1).sort(), ['agent', 'cache_read', 'cache_write', 'id', 'input', 'kind', 'model', 'output', 'time']);
  assert.match(r1.id, /^[a-f0-9]{40}$/);
  assert.equal(collectUsage(state, { transcript_path: file }, opts).length, 0, 'nothing new, nothing sent');

  fs.appendFileSync(file, `${claude('m2', 'claude-opus-5-5', { output_tokens: 1 })}\n`);
  const [r2] = collectUsage(state, { transcript_path: file }, opts);
  assert.equal(r2.output, 1);
  assert.notEqual(r2.id, r1.id);
  // A crash before the state was saved replays the same read with the same id (the server ignores it).
  assert.equal(collectUsage({}, { transcript_path: file }, opts)[0].id, r1.id);
  assert.ok(!JSON.stringify(state).includes(file), 'the state file keys transcripts by hash');
  assert.deepEqual(collectUsage({}, { transcript_path: 'relative.jsonl' }, opts), []);
});

test('collectUsage also reads a subagent transcript, with its own cursor', () => {
  const dir = tmpDir();
  const main = path.join(dir, 'session.jsonl');
  const sub = path.join(dir, 'session', 'subagents', 'agent-a1.jsonl');
  fs.mkdirSync(path.dirname(sub), { recursive: true });
  fs.writeFileSync(main, `${claude('m1', 'claude-opus-5-5', { input_tokens: 4, output_tokens: 6 })}\n`);
  fs.writeFileSync(sub, [
    claude('s1', 'claude-haiku-5-5', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 3000 }),
    claude('s2', 'claude-haiku-5-5', { input_tokens: 50, output_tokens: 5 }),
  ].join('\n') + '\n');
  const state = {};
  const opts = { agent: 'claude-code', now: 1_800_000_000, entityKey: KEY_HEX };
  const stop = { hook_event_name: 'SubagentStop', transcript_path: main, agent_transcript_path: sub };

  const first = collectUsage(state, stop, opts);
  assert.deepEqual(first.map(({ id, time, kind, agent, ...u }) => u), [
    { model: 'claude-opus-5-5', input: 4, output: 6, cache_read: 0, cache_write: 0 },
    { model: 'claude-haiku-5-5', input: 150, output: 25, cache_read: 3000, cache_write: 0 },
  ]);
  assert.equal(new Set(first.map((r) => r.id)).size, 2, 'records from the two files get distinct ids');
  assert.equal(Object.keys(state.usage).length, 2, 'one cursor per transcript');
  assert.deepEqual(collectUsage(state, stop, opts), [], 'nothing new in either file');

  // The main turn's Stop afterwards must not count the subagent again, nor the main part twice.
  fs.appendFileSync(main, `${claude('m2', 'claude-opus-5-5', { output_tokens: 2 })}\n`);
  const after = collectUsage(state, { hook_event_name: 'Stop', transcript_path: main }, opts);
  assert.deepEqual(after.map((r) => [r.model, r.output]), [['claude-opus-5-5', 2]]);

  // Same path in both fields is read once; a relative agent path is ignored.
  fs.appendFileSync(sub, `${claude('s3', 'claude-haiku-5-5', { output_tokens: 7 })}\n`);
  assert.deepEqual(collectUsage(state, { transcript_path: sub, agent_transcript_path: sub }, opts).map((r) => r.output), [7]);
  assert.deepEqual(collectUsage({}, { agent_transcript_path: 'subagents/agent-x.jsonl' }, opts), []);
  assert.ok(!JSON.stringify(state).includes(dir), 'cursors are keyed by hash, not path');
});

test('requestBody puts usage records next to heartbeats and drops the marker', () => {
  const hb = { time: 1, project: 'p', editor: 'codex', category: 'ai' };
  assert.deepEqual(requestBody([hb]), { heartbeats: [hb] });
  assert.deepEqual(requestBody([hb, { kind: 'usage', id: 'x', model: 'm' }]), { heartbeats: [hb], usage: [{ id: 'x', model: 'm' }] });
});

function runHook(env, payload, agent = 'claude-code') {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK, '--agent', agent], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('close', (code) => resolve(code));
    child.stdin.end(JSON.stringify(payload));
  });
}

async function setup(t, config = {}) {
  const server = await startServer(() => [202, { accepted: 0, duplicates: 0, usage: 1 }]);
  t.after(server.close);
  const home = tmpDir('ember-home-');
  const env = isolatedEnv(home);
  fs.mkdirSync(env.EMBER_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.EMBER_HOME, 'config.json'), JSON.stringify({ api_key: KEY, api_url: server.url, ...config }));
  const repo = makeRepo(path.join(tmpDir(), 'proj'));
  const transcript = path.join(tmpDir(), 'codex-rollout.jsonl');
  fs.writeFileSync(transcript, [codexTurn('gpt-6-luna'), codexTotals({ input_tokens: 500, cached_input_tokens: 100, output_tokens: 20 })].join('\n') + '\n');
  return { server, env, repo, transcript };
}

test('a Stop event sends the turn\'s token usage once', async (t) => {
  const { server, env, repo, transcript } = await setup(t);
  const stop = { hook_event_name: 'Stop', cwd: repo, session_id: 's', transcript_path: transcript };
  assert.equal(await runHook(env, stop, 'codex'), 0);
  assert.equal(await runHook(env, stop, 'codex'), 0);
  assert.equal(server.requests.length, 1);
  const { body } = server.requests[0];
  assert.deepEqual(body.heartbeats, []);
  assert.equal(body.usage.length, 1);
  const { id, time, ...rest } = body.usage[0];
  assert.deepEqual(rest, { agent: 'codex', model: 'gpt-6-luna', input: 400, output: 20, cache_read: 100, cache_write: 0 });
  assert.ok(!server.requests[0].raw.includes(transcript));
});

test('send_usage: false keeps token counts on the machine', async (t) => {
  const { server, env, repo, transcript } = await setup(t, { send_usage: false });
  await runHook(env, { hook_event_name: 'Stop', cwd: repo, transcript_path: transcript }, 'codex');
  assert.equal(server.requests.length, 0);
});

test('a SubagentStop event sends the subagent\'s tokens next to the main session\'s', async (t) => {
  const { server, env, repo } = await setup(t);
  const dir = tmpDir();
  const main = path.join(dir, 's.jsonl');
  const sub = path.join(dir, 's', 'subagents', 'agent-x.jsonl');
  fs.mkdirSync(path.dirname(sub), { recursive: true });
  fs.writeFileSync(main, `${claude('m1', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 2 })}\n`);
  fs.writeFileSync(sub, `${claude('x1', 'claude-sonnet-5-5', { input_tokens: 30, output_tokens: 40, cache_creation_input_tokens: 9 })}\n`);
  const event = {
    hook_event_name: 'SubagentStop', cwd: repo, session_id: 's', agent_id: 'x', agent_type: 'Explore',
    transcript_path: main, agent_transcript_path: sub, last_assistant_message: 'SECRET_TEXT',
  };
  assert.equal(await runHook(env, event), 0);
  assert.equal(await runHook(env, event), 0);
  assert.equal(server.requests.length, 1);
  const usage = server.requests[0].body.usage.map(({ id, time, ...u }) => u);
  assert.deepEqual(usage, [
    { agent: 'claude-code', model: 'claude-opus-5-5', input: 1, output: 2, cache_read: 0, cache_write: 0 },
    { agent: 'claude-code', model: 'claude-sonnet-5-5', input: 30, output: 40, cache_read: 0, cache_write: 9 },
  ]);
  for (const s of [sub, main, 'SECRET_TEXT', 'Explore']) assert.ok(!server.requests[0].raw.includes(s), s);
});
