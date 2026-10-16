#!/usr/bin/env node
// Ember hook installer.
//
//   node install.mjs claude [--uninstall] [--key <ember_...>] [--api-url <url>]
//   node install.mjs codex  [--uninstall] [--key <ember_...>] [--api-url <url>]
//   node install.mjs --key <ember_...>            (only write ~/.ember/config.json)
//
// claude -> merges hooks into ~/.claude/settings.json
// codex  -> merges hooks into ~/.codex/hooks.json (or $CODEX_HOME/hooks.json)
//
// The target file is backed up (<file>.bak-<timestamp>) before any change.
// Re-running is idempotent: existing Ember entries (any command that
// references ember-hook.mjs) are replaced, everything else is left untouched.
// HOME (and EMBER_HOME / CODEX_HOME) are respected, so it can be tested safely.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ember-hook.mjs');
const MARKER = 'ember-hook.mjs';
const KEY_RE = /^ember_[0-9a-f]{40}$/i;

export const TARGETS = {
  claude: {
    agent: 'claude-code',
    events: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'],
    file: (env) => path.join(homeDir(env), '.claude', 'settings.json'),
  },
  codex: {
    agent: 'codex',
    events: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'],
    file: (env) => path.join(env.CODEX_HOME || path.join(homeDir(env), '.codex'), 'hooks.json'),
  },
};

function homeDir(env) {
  return env.HOME || os.homedir();
}

function quote(p) {
  return `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
}

export function hookCommand(agent, { nodePath = process.execPath, script = HOOK_SCRIPT } = {}) {
  return `${quote(nodePath)} ${quote(script)} --agent ${agent}`;
}

function isEmberHook(h) {
  return h && typeof h.command === 'string' && h.command.includes(MARKER);
}

/** Remove every Ember hook from a settings object (mutates). Returns events touched. */
export function removeEmberHooks(settings) {
  const touched = [];
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return touched;
  for (const event of Object.keys(hooks)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    let changed = false;
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const rest = group.hooks.filter((h) => !isEmberHook(h));
      if (rest.length !== group.hooks.length) changed = true;
      if (rest.length) kept.push({ ...group, hooks: rest });
    }
    if (changed) {
      touched.push(event);
      if (kept.length) hooks[event] = kept;
      else delete hooks[event];
    }
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return touched;
}

/** Add Ember hooks for `events` (mutates). Call removeEmberHooks first for idempotency. */
export function addEmberHooks(settings, events, command) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  for (const event of events) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    // No matcher: applies to every tool for PostToolUse and is ignored elsewhere.
    settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.(\d+)Z$/, '$1Z');
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { exists: false, settings: {} };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return { exists: true, settings: {} };
  const settings = JSON.parse(text); // throws on invalid JSON: never clobber a file we can't parse
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${file} does not contain a JSON object`);
  }
  return { exists: true, settings };
}

function backup(file) {
  const dest = `${file}.bak-${timestamp()}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function writeJson(file, obj, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/** Write api_key / api_url into ~/.ember/config.json (0600), preserving other fields. */
export function writeEmberConfig({ key, apiUrl, env = process.env }) {
  const home = env.EMBER_HOME || path.join(homeDir(env), '.ember');
  const file = path.join(home, 'config.json');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    /* new or unreadable config */
  }
  if (key) cfg.api_key = key;
  if (apiUrl) cfg.api_url = apiUrl.replace(/\/+$/, '');
  if (!cfg.api_url) cfg.api_url = 'https://ember-dev.vercel.app';
  writeJson(file, cfg, 0o600);
  return file;
}

/** Install or uninstall hooks for one target. Returns a summary; throws on unparseable target file. */
export function apply(targetName, { uninstall = false, env = process.env, nodePath, script } = {}) {
  const target = TARGETS[targetName];
  if (!target) throw new Error(`unknown target "${targetName}" (expected claude or codex)`);
  const file = target.file(env);
  const { exists, settings } = readSettings(file);
  const before = JSON.stringify(settings);

  const removed = removeEmberHooks(settings);
  const command = hookCommand(target.agent, { nodePath, script });
  if (!uninstall) addEmberHooks(settings, target.events, command);

  if (JSON.stringify(settings) === before) {
    return { file, changed: false, backup: null, removed, added: [], command };
  }
  const backupFile = exists ? backup(file) : null;
  writeJson(file, settings);
  return { file, changed: true, backup: backupFile, removed, added: uninstall ? [] : target.events, command };
}

function parseCli(argv) {
  const opts = { target: undefined, uninstall: false, key: undefined, apiUrl: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uninstall') opts.uninstall = true;
    else if (a === '--key') opts.key = argv[++i];
    else if (a.startsWith('--key=')) opts.key = a.slice(6);
    else if (a === '--api-url') opts.apiUrl = argv[++i];
    else if (a.startsWith('--api-url=')) opts.apiUrl = a.slice(10);
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-') && !opts.target) opts.target = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return opts;
}

const USAGE = `Usage: node install.mjs <claude|codex> [--uninstall] [--key <ember_key>] [--api-url <url>]
       node install.mjs --key <ember_key> [--api-url <url>]`;

function main() {
  let opts;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 1;
  }
  if (opts.help || (!opts.target && !opts.key && !opts.apiUrl)) {
    console.log(USAGE);
    return opts.help ? 0 : 1;
  }
  if (opts.key !== undefined && !KEY_RE.test(opts.key)) {
    console.error('Invalid key: expected "ember_" followed by 40 hex characters.');
    return 1;
  }

  if (opts.key || opts.apiUrl) {
    const file = writeEmberConfig({ key: opts.key, apiUrl: opts.apiUrl });
    console.log(`Wrote ${file} (mode 0600)`);
  }
  if (!opts.target) return 0;

  let result;
  try {
    result = apply(opts.target, { uninstall: opts.uninstall });
  } catch (e) {
    console.error(`Error: ${e.message}`);
    return 1;
  }

  if (!result.changed) {
    console.log(`No changes needed in ${result.file}`);
  } else {
    if (result.backup) console.log(`Backed up ${result.file} -> ${result.backup}`);
    if (result.removed.length) console.log(`Removed Ember hooks from: ${result.removed.join(', ')}`);
    if (result.added.length) {
      console.log(`Added Ember hooks for: ${result.added.join(', ')}`);
      console.log(`  command: ${result.command}`);
    }
    console.log(`Updated ${result.file}`);
  }
  if (opts.target === 'codex' && !opts.uninstall) {
    console.log(
      '\nCodex: hooks that are not managed by your organisation must be reviewed and trusted\n' +
        'before they run. Start Codex and open /hooks to review and trust the Ember hooks.',
    );
  }
  if (!opts.uninstall && !opts.key) {
    const cfg = path.join(process.env.EMBER_HOME || path.join(homeDir(process.env), '.ember'), 'config.json');
    if (!fs.existsSync(cfg)) console.log(`\nNo API key yet: run again with --key <ember_...> or set it in VS Code.`);
  }
  return 0;
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main();
