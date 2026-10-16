// End-to-end: spawn ember-hook.mjs exactly as an agent would (JSON on stdin),
// always with a temp HOME / EMBER_HOME so the real ~/.ember is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, makeRepo, startServer, isolatedEnv, KEY } from './helpers.mjs';

const HOOK = fileURLToPath(new URL('../ember-hook.mjs', import.meta.url));

function runHook(args, { env, stdin, closeStdin = true }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    if (stdin !== undefined) child.stdin.write(stdin);
    if (closeStdin) child.stdin.end();
  });
}

function setup(serverUrl) {
  const home = tmpDir('ember-home-');
  const env = isolatedEnv(home);
  fs.mkdirSync(env.EMBER_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.EMBER_HOME, 'config.json'), JSON.stringify({ api_key: KEY, api_url: serverUrl }));
  return { home, env };
}

test('claude-code file edit on stdin is sent; stdout stays empty; exit 0', async (t) => {
  const server = await startServer(() => [202, { accepted: 1, duplicates: 0 }]);
  t.after(server.close);
  const { env } = setup(server.url);
  const repo = makeRepo(path.join(tmpDir(), 'demo'), { branch: 'dev' });
  const payload = {
    session_id: 'abc',
    transcript_path: '/tmp/t.jsonl',
    cwd: repo,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.ts', old_string: 'TOP SECRET OLD', new_string: 'TOP SECRET NEW' },
  };
  const r = await runHook(['--agent', 'claude-code'], { env, stdin: JSON.stringify(payload) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(server.requests.length, 1);
  const [h] = server.requests[0].body.heartbeats;
  assert.equal(h.editor, 'claude-code');
  assert.equal(h.project, 'demo');
  assert.equal(h.branch, 'dev');
  assert.equal(h.category, 'ai');
  assert.equal(h.is_write, true);
  assert.equal(h.language, 'TypeScript');
  assert.ok(!server.requests[0].raw.includes('TOP SECRET'));
  assert.ok(!server.requests[0].raw.includes('src/app.ts'));
});

test('opening a session, prompting or reading files sends no time', async (t) => {
  const server = await startServer(() => [202, { accepted: 1, duplicates: 0 }]);
  t.after(server.close);
  const { env } = setup(server.url);
  const cwd = makeRepo(path.join(tmpDir(), 'idle'));
  for (const payload of [
    { cwd, hook_event_name: 'SessionStart' },
    { cwd, hook_event_name: 'UserPromptSubmit', prompt: 'TOP SECRET PROMPT' },
    { cwd, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'a.ts' } },
    { cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
    { cwd, hook_event_name: 'Stop' },
  ]) {
    const r = await runHook(['--agent', 'claude-code'], { env, stdin: JSON.stringify(payload) });
    assert.equal(r.code, 0);
  }
  assert.equal(server.requests.length, 0);
  assert.ok(!fs.existsSync(path.join(env.EMBER_HOME, 'queue.jsonl')) || fs.readFileSync(path.join(env.EMBER_HOME, 'queue.jsonl'), 'utf8').trim() === '');
});

test('codex edits are throttled to one per 30s; session events add nothing', async (t) => {
  const server = await startServer(() => [202, { accepted: 1, duplicates: 0 }]);
  t.after(server.close);
  const { env } = setup(server.url);
  const repo = makeRepo(path.join(tmpDir(), 'cx'));
  const post = { session_id: 's', cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: a.go\n*** End Patch' } };

  await runHook(['--agent', 'codex'], { env, stdin: JSON.stringify(post) });
  await runHook(['--agent', 'codex'], { env, stdin: JSON.stringify(post) }); // throttled
  await runHook(['--agent', 'codex'], { env, stdin: JSON.stringify({ ...post, hook_event_name: 'Stop', tool_name: undefined, tool_input: undefined }) });
  await runHook(['--agent', 'codex'], { env, stdin: JSON.stringify({ ...post, hook_event_name: 'SessionEnd', tool_name: undefined, tool_input: undefined }) });

  const sent = server.requests.flatMap((r) => r.body.heartbeats);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].language, 'Go');
  assert.equal(sent[0].is_write, true);
  assert.ok(sent.every((h) => h.editor === 'codex'));
});

test('server down: hook still exits 0 quickly and queues the heartbeat', async () => {
  const { env } = setup('http://127.0.0.1:9');
  const edit = { cwd: tmpDir(), hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'x.py' } };
  const r = await runHook(['--agent', 'claude-code'], { env, stdin: JSON.stringify(edit) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 4000, `took ${r.ms}ms`);
  const queue = fs.readFileSync(path.join(env.EMBER_HOME, 'queue.jsonl'), 'utf8').trim().split('\n');
  assert.equal(queue.length, 1);
});

test('stdin that never closes is abandoned after ~1s; bad args never fail', async () => {
  const { env } = setup('http://127.0.0.1:9');
  const r = await runHook(['--agent', 'codex'], { env, stdin: '{"cwd":', closeStdin: false });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms >= 900 && r.ms < 5000, `took ${r.ms}ms`);

  const bad = await runHook(['--agent', 'emacs'], { env, stdin: '{}' });
  assert.equal(bad.code, 0);
  assert.equal(bad.stdout, '');
  assert.match(fs.readFileSync(path.join(env.EMBER_HOME, 'hook.log'), 'utf8'), /unknown --agent/);
});

test('EMBER_API_URL / EMBER_API_KEY env overrides win over config.json', async (t) => {
  const server = await startServer(() => [202, { accepted: 1, duplicates: 0 }]);
  t.after(server.close);
  const { env } = setup('http://127.0.0.1:9'); // config points nowhere
  const key2 = `ember_${'b2'.repeat(20)}`;
  const r = await runHook(['--agent', 'claude-code'], {
    env: { ...env, EMBER_API_URL: server.url, EMBER_API_KEY: key2 },
    stdin: JSON.stringify({ cwd: tmpDir(), hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'y.rs' } }),
  });
  assert.equal(r.code, 0);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].headers.authorization, `Bearer ${key2}`);
});
