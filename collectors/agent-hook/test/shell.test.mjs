// Files an agent writes through a shell command (sed -i, echo >, codegen scripts)
// count as AI writing; reads, ignored paths and old edits don't. Branch opt-out.
// Real git repos in temp dirs, temp HOME / EMBER_HOME throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runHook, recentlyChangedFile, entityHash, loadEntityKey } from '../ember-hook.mjs';
import { tmpDir, startServer, isolatedEnv, KEY } from './helpers.mjs';

function gitRepo(name, files = {}) {
  const root = path.join(tmpDir(), name);
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'feature/secret-client');
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), content);
  }
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init', '--allow-empty');
  return root;
}

/** Set a file's mtime `ago` seconds in the past. */
function age(file, ago) {
  const t = Date.now() / 1000 - ago;
  fs.utimesSync(file, t, t);
}

async function session(t, config = {}) {
  const server = await startServer(() => [202, { accepted: 1, duplicates: 0 }]);
  t.after(server.close);
  const env = isolatedEnv(tmpDir('ember-home-'));
  fs.mkdirSync(env.EMBER_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.EMBER_HOME, 'config.json'), JSON.stringify({ api_key: KEY, api_url: server.url, ...config }));
  const send = (payload) => runHook({ argv: ['--agent', 'claude-code'], env, stdinText: JSON.stringify(payload) });
  const beats = () => server.requests.flatMap((r) => r.body.heartbeats);
  return { env, send, beats };
}

test('a shell command that writes a file produces one AI heartbeat for that file', async (t) => {
  const root = gitRepo('shell-proj', { 'src/a.py': 'x = 1\n', '.gitignore': 'build/\n' });
  const { env, send, beats } = await session(t);
  await send({ hook_event_name: 'UserPromptSubmit', cwd: root, prompt: 'refactor' });

  fs.writeFileSync(path.join(root, 'src/a.py'), 'x = 2\n'); // as `sed -i` would
  const r = await send({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_input: { command: "sed -i 's/1/2/' src/a.py" } });

  assert.equal(r.status, 'ok');
  const [hb] = beats();
  assert.equal(hb.is_write, true);
  assert.equal(hb.category, 'ai');
  assert.equal(hb.language, 'Python');
  assert.equal(hb.entity, entityHash(loadEntityKey(env.EMBER_HOME), path.join(root, 'src/a.py')));
});

test('read-only commands, ignored output and edits before the previous step do not count', async (t) => {
  const root = gitRepo('quiet-proj', { 'main.go': 'package main\n', '.gitignore': 'build/\n' });
  const { send, beats } = await session(t);

  // Edited by hand long before the agent's previous step.
  fs.writeFileSync(path.join(root, 'main.go'), 'package main // edited\n');
  age(path.join(root, 'main.go'), 300);
  await send({ hook_event_name: 'UserPromptSubmit', cwd: root, prompt: 'build it' });

  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build/out.bin'), 'binary'); // ignored by .gitignore
  const r = await send({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_input: { command: 'go build -o build/out.bin && ls' } });

  assert.equal(r.status, 'not-writing');
  assert.equal(beats().length, 0);
});

test('outside a git checkout a shell command never counts', async (t) => {
  const plain = tmpDir('no-git-');
  const { send, beats } = await session(t);
  fs.writeFileSync(path.join(plain, 'notes.txt'), 'hi');
  const r = await send({ hook_event_name: 'PostToolUse', cwd: plain, tool_name: 'Bash', tool_input: { command: 'echo hi > notes.txt' } });
  assert.equal(r.status, 'not-writing');
  assert.equal(beats().length, 0);
});

test('recentlyChangedFile picks the newest change after the cutoff, including new files', () => {
  const root = gitRepo('pick', { 'a.ts': '1', 'b.ts': '1' });
  const now = Date.now() / 1000;
  fs.writeFileSync(path.join(root, 'a.ts'), '2');
  age(path.join(root, 'a.ts'), 30);
  fs.writeFileSync(path.join(root, 'new.rs'), 'fn main() {}');
  age(path.join(root, 'new.rs'), 5);
  assert.equal(recentlyChangedFile(root, now - 60), path.join(root, 'new.rs'));
  assert.equal(recentlyChangedFile(root, now - 1), undefined);
  assert.equal(recentlyChangedFile(path.join(root, 'missing'), 0), undefined);
});

test('send_branch: false in config.json, or EMBER_SEND_BRANCH=0, keeps branch names local', async (t) => {
  const root = gitRepo('branchy', { 'x.ts': '1' });
  const write = { hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'x.ts') } };

  const off = await session(t, { send_branch: false });
  await off.send(write);
  assert.equal(off.beats()[0].branch, undefined);

  const on = await session(t);
  await on.send(write);
  assert.equal(on.beats()[0].branch, 'feature/secret-client');

  const envOff = await session(t);
  envOff.env.EMBER_SEND_BRANCH = '0';
  await envOff.send(write);
  assert.equal(envOff.beats()[0].branch, undefined);
});
