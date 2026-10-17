// Privacy regression: run the real hook through a whole Claude Code session whose
// prompts, tool inputs, tool output, file names and paths all carry marker strings,
// against a fake server, and check every byte that left the machine. Only the
// fields documented in the README may appear. Temp HOME / EMBER_HOME throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { entityHash, loadEntityKey } from '../ember-hook.mjs';
import { tmpDir, makeRepo, startServer, isolatedEnv, KEY } from './helpers.mjs';

const HOOK = fileURLToPath(new URL('../ember-hook.mjs', import.meta.url));
const DOCUMENTED_FIELDS = ['branch', 'category', 'editor', 'entity', 'is_write', 'language', 'project', 'stack', 'time'];

function runHook(env, payload) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK, '--agent', 'claude-code'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('a full agent session sends only documented fields and no prompt, code, output or path', async (t) => {
  const server = await startServer(() => [202, { accepted: 1, duplicates: 0 }]);
  t.after(server.close);
  const home = tmpDir('ember-home-');
  const env = isolatedEnv(home);
  fs.mkdirSync(env.EMBER_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.EMBER_HOME, 'config.json'), JSON.stringify({ api_key: KEY, api_url: server.url }));

  const repo = makeRepo(path.join(tmpDir(), 'client-repo'), {
    branch: 'feature/login',
    files: { 'package.json': JSON.stringify({ dependencies: { next: '16', react: '19' } }) },
  });
  const written = path.join(repo, 'src', 'MARK_FILENAME.ts');
  const markers = ['MARK_PROMPT', 'MARK_CODE', 'MARK_OUTPUT', 'MARK_FILENAME', 'MARK_CMD', 'MARK_READ', repo, home];
  const session = [
    { hook_event_name: 'SessionStart', cwd: repo, session_id: 's1' },
    { hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: 'fix MARK_PROMPT in billing' },
    { hook_event_name: 'PostToolUse', cwd: repo, tool_name: 'Read', tool_input: { file_path: path.join(repo, 'MARK_READ.ts') }, tool_response: 'MARK_OUTPUT' },
    { hook_event_name: 'PostToolUse', cwd: repo, tool_name: 'Bash', tool_input: { command: 'echo MARK_CMD > notes.txt' }, tool_response: 'MARK_OUTPUT' },
    { hook_event_name: 'PostToolUse', cwd: repo, tool_name: 'Write', tool_input: { file_path: written, content: 'const k = "MARK_CODE";' }, tool_response: 'MARK_OUTPUT' },
    { hook_event_name: 'Stop', cwd: repo },
  ];

  for (const event of session) {
    const r = await runHook(env, event);
    assert.equal(r.code, 0, `${event.hook_event_name} exits 0`);
    assert.equal(r.stdout, '', `${event.hook_event_name} prints nothing`);
  }

  assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), ['POST /api/v1/heartbeats'], 'one request, to the heartbeat endpoint only');
  const sent = server.requests.map((r) => r.raw).join('\n');
  for (const m of markers) assert.ok(!sent.includes(m), `must not send ${m}`);

  const beats = server.requests[0].body.heartbeats;
  assert.equal(beats.length, 1, 'only the file write produces a heartbeat');
  const [hb] = beats;
  assert.deepEqual(Object.keys(hb).sort(), DOCUMENTED_FIELDS);
  assert.equal(hb.project, 'client-repo');
  assert.equal(hb.branch, 'feature/login');
  assert.deepEqual(hb.stack, ['Next.js', 'React']);

  // The entity is keyed by this machine's secret, so guessing the path doesn't reveal it.
  assert.equal(hb.entity, entityHash(loadEntityKey(env.EMBER_HOME), written));
  assert.notEqual(hb.entity, crypto.createHash('sha1').update(written).digest('hex'));
  assert.equal(fs.statSync(path.join(env.EMBER_HOME, 'entity.key')).mode & 0o777, 0o600);
});
