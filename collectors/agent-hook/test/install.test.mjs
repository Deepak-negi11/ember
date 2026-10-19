// install.mjs tests. Every run uses a temp HOME; the real ~/.claude and
// ~/.codex are never read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../install.mjs';
import { tmpDir, isolatedEnv, KEY } from './helpers.mjs';

const INSTALL = fileURLToPath(new URL('../install.mjs', import.meta.url));
const PLUGIN_HOOKS = fileURLToPath(new URL('../hooks/hooks.json', import.meta.url));

function install(home, ...args) {
  const r = spawnSync(process.execPath, [INSTALL, ...args], { env: isolatedEnv(home), encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const emberCount = (settings) =>
  Object.values(settings.hooks || {}).flat().flatMap((g) => g.hooks).filter((h) => h.command.includes('ember-hook.mjs')).length;

test('claude: merges into existing settings, idempotent, backs up, uninstalls only Ember', () => {
  const home = tmpDir('ember-home-');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = {
    model: 'opus',
    hooks: {
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }],
      Notification: [{ hooks: [{ type: 'command', command: 'say hi' }] }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(original));

  const r1 = install(home, 'claude');
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /Added Ember hooks for: SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop$/m);
  const s1 = readJson(file);
  assert.equal(s1.model, 'opus');
  assert.equal(emberCount(s1), 5);
  assert.equal(s1.hooks.PostToolUse.length, 2, 'user hook kept alongside Ember');
  const cmd = s1.hooks.Stop[0].hooks[0].command;
  assert.ok(cmd.startsWith(`"${process.execPath}" "`), cmd);
  assert.ok(cmd.endsWith('ember-hook.mjs" --agent claude-code'), cmd);
  assert.equal(fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('settings.json.bak-')).length, 1);

  const r2 = install(home, 'claude');
  assert.equal(r2.code, 0);
  assert.match(r2.out, /No changes needed/);
  assert.deepEqual(readJson(file), s1);

  const r3 = install(home, 'claude', '--uninstall');
  assert.equal(r3.code, 0, r3.out);
  assert.deepEqual(readJson(file), original);
});

test('codex: creates ~/.codex/hooks.json with SessionEnd and prints the /hooks reminder', () => {
  const home = tmpDir('ember-home-');
  const r = install(home, 'codex');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\/hooks/);
  const file = path.join(home, '.codex', 'hooks.json');
  const s = readJson(file);
  assert.deepEqual(Object.keys(s.hooks), ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']);
  assert.ok(s.hooks.SessionEnd[0].hooks[0].command.endsWith('--agent codex'));

  install(home, 'codex');
  assert.equal(emberCount(readJson(file)), 5);

  install(home, 'codex', '--uninstall');
  assert.deepEqual(readJson(file), {});
});

test('--key writes ~/.ember/config.json with mode 0600 and validates the key', () => {
  const home = tmpDir('ember-home-');
  fs.mkdirSync(path.join(home, '.ember'));
  fs.writeFileSync(path.join(home, '.ember', 'config.json'), JSON.stringify({ api_url: 'https://ember.example.com' }));

  const r = install(home, '--key', KEY);
  assert.equal(r.code, 0, r.out);
  const cfgFile = path.join(home, '.ember', 'config.json');
  assert.deepEqual(readJson(cfgFile), { api_url: 'https://ember.example.com', api_key: KEY });
  assert.equal(fs.statSync(cfgFile).mode & 0o777, 0o600);

  const bad = install(home, '--key', 'sk-not-ember');
  assert.equal(bad.code, 1);
  assert.equal(readJson(cfgFile).api_key, KEY);
});

test('refuses to overwrite an unparseable settings file', () => {
  const home = tmpDir('ember-home-');
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const r = install(home, 'claude');
  assert.equal(r.code, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('cursor: writes ~/.cursor/hooks.json in Cursor format, keeps user hooks, idempotent, uninstalls only Ember', () => {
  const home = tmpDir('ember-home-');
  const file = path.join(home, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './hooks/format.sh' }] } }));

  assert.equal(install(home, 'cursor').code, 0);
  const once = readJson(file);
  assert.equal(once.version, 1);
  const ember = (s) => Object.values(s.hooks || {}).flat().filter((h) => h.command.includes('ember-hook.mjs'));
  assert.deepEqual(Object.keys(once.hooks).sort(), ['afterFileEdit', 'beforeSubmitPrompt', 'sessionStart', 'stop']);
  assert.equal(ember(once).length, 4);
  assert.ok(ember(once).every((h) => h.command.includes('--agent cursor-agent') && h.timeout === 10));
  assert.ok(once.hooks.afterFileEdit.some((h) => h.command === './hooks/format.sh'));

  install(home, 'cursor');
  assert.equal(ember(readJson(file)).length, 4, 'second run must not duplicate');

  assert.equal(install(home, 'cursor', '--uninstall').code, 0);
  assert.deepEqual(readJson(file), { version: 1, hooks: { afterFileEdit: [{ command: './hooks/format.sh' }] } });
});

test('claude: the plugin and the installer register the same events, SubagentStop included', () => {
  const plugin = Object.keys(JSON.parse(fs.readFileSync(PLUGIN_HOOKS, 'utf8')).hooks);
  assert.deepEqual(plugin, TARGETS.claude.events);
  assert.ok(plugin.includes('SubagentStop'), 'subagent transcripts are only read on SubagentStop');
});
