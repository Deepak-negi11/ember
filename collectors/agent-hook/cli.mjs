#!/usr/bin/env node
// embertime: one command to connect every editor and AI agent on this machine
// (VS Code, Cursor, Windsurf, VSCodium, Claude Code, Codex, Cursor Agent).
//
//   npx embertime setup --key ember_...     install everything that is found
//   npx embertime status                    show what is connected
//   npx embertime uninstall [--purge]       remove hooks (and ~/.ember with --purge)
//
// Zero dependencies. Respects HOME / EMBER_HOME / CODEX_HOME so it can be tested.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, writeEmberConfig } from './install.mjs';

// Public server and Marketplace id. Change DEFAULT_API_URL before publishing.
export const DEFAULT_API_URL = process.env.EMBER_DEFAULT_API_URL || 'https://ember-dev.vercel.app';
export const EXTENSION_ID = 'ember-dev.ember';
const KEY_RE = /^ember_[0-9a-f]{40}$/i;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD = ['ember-hook.mjs', 'install.mjs', 'package.json'];
const EDITORS = [
  { cli: 'code', name: 'VS Code' },
  { cli: 'cursor', name: 'Cursor' },
  { cli: 'windsurf', name: 'Windsurf' },
  { cli: 'codium', name: 'VSCodium' },
];

const env = process.env;
const home = () => env.HOME || os.homedir();
const emberHome = () => env.EMBER_HOME || path.join(home(), '.ember');

const c = process.stdout.isTTY && !env.NO_COLOR
  ? { ok: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { ok: (s) => s, dim: (s) => s, warn: (s) => s, bold: (s) => s };

function onPath(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

/** Copy the hook to a stable place. npx caches get cleaned, so hooks must not point into them. */
function installPayload() {
  const dest = path.join(emberHome(), 'agent-hook');
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const f of PAYLOAD) fs.copyFileSync(path.join(HERE, f), path.join(dest, f));
  return path.join(dest, 'ember-hook.mjs');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(emberHome(), 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--key') o.key = argv[++i];
    else if (a.startsWith('--key=')) o.key = a.slice(6);
    else if (a === '--api-url') o.apiUrl = argv[++i];
    else if (a.startsWith('--api-url=')) o.apiUrl = a.slice(10);
    else if (a === '--vsix') o.vsix = argv[++i];
    else if (a === '--skip-editors') o.skipEditors = true;
    else if (a === '--purge') o.purge = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else o._.push(a);
  }
  return o;
}

async function setup(o) {
  const cfg = readConfig();
  const key = o.key || env.EMBER_API_KEY || cfg.api_key;
  if (!key || !KEY_RE.test(key)) {
    console.error('Missing or invalid API key. Copy it from Settings on your Ember dashboard:\n  npx embertime setup --key ember_...');
    process.exit(1);
  }
  const apiUrl = (o.apiUrl || cfg.api_url || DEFAULT_API_URL).replace(/\/+$/, '');

  // Check the key against the server before touching any config.
  try {
    const res = await fetch(`${apiUrl}/api/v1/me/today`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
    if (res.status === 401) {
      console.error(`The server at ${apiUrl} rejected that key. Create a new one in Settings and try again.`);
      process.exit(1);
    }
    if (res.ok) {
      const me = await res.json();
      console.log(`${c.ok('✓')} Signed in as ${c.bold('@' + me.username)} on ${apiUrl}`);
    } else console.log(c.warn(`! ${apiUrl} answered ${res.status}; continuing, activity will queue until it is reachable.`));
  } catch {
    console.log(c.warn(`! Could not reach ${apiUrl}; continuing, activity will queue until it is reachable.`));
  }

  writeEmberConfig({ key, apiUrl, env });
  console.log(`${c.ok('✓')} Saved key to ${path.join(emberHome(), 'config.json')} ${c.dim('(private, 0600)')}`);

  const script = installPayload();
  const results = [];

  const hasClaude = fs.existsSync(path.join(home(), '.claude')) || onPath('claude');
  const hasCodex = fs.existsSync(env.CODEX_HOME || path.join(home(), '.codex')) || onPath('codex');
  const hasCursor = fs.existsSync(path.join(home(), '.cursor')) || onPath('cursor');
  for (const [target, found, label] of [
    ['claude', hasClaude, 'Claude Code'],
    ['codex', hasCodex, 'Codex'],
    ['cursor', hasCursor, 'Cursor Agent'],
  ]) {
    if (!found) {
      results.push([label, 'not found, skipped']);
      continue;
    }
    const r = apply(target, { env, script });
    results.push([label, r.changed ? `hooks installed${r.backup ? c.dim(` (backup: ${r.backup})`) : ''}` : 'already up to date', true]);
  }

  if (!o.skipEditors) {
    for (const e of EDITORS) {
      if (!onPath(e.cli)) continue;
      const r = spawnSync(e.cli, ['--install-extension', o.vsix || EXTENSION_ID, '--force'], { encoding: 'utf8' });
      results.push([e.name, r.status === 0 ? 'extension installed' : `install failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`, r.status === 0]);
    }
  }

  console.log('');
  for (const [label, msg, ok] of results) console.log(`${ok ? c.ok('✓') : c.dim('–')} ${label.padEnd(12)} ${msg}`);
  if (hasCodex) console.log(`\n${c.warn('Codex:')} open Codex and run /hooks once to trust the Ember entries.`);
  console.log(`\nDone. Write some code and watch ${apiUrl}/dashboard light up.`);
}

async function status() {
  const cfg = readConfig();
  console.log(`config   ${cfg.api_key ? `key …${cfg.api_key.slice(-4)}, server ${cfg.api_url}` : 'no key (run setup)'}`);
  for (const [label, file] of [
    ['claude', path.join(home(), '.claude', 'settings.json')],
    ['codex', path.join(env.CODEX_HOME || path.join(home(), '.codex'), 'hooks.json')],
    ['cursor', path.join(home(), '.cursor', 'hooks.json')],
  ]) {
    let on = false;
    try { on = fs.readFileSync(file, 'utf8').includes('ember-hook.mjs'); } catch { /* missing */ }
    console.log(`${label.padEnd(8)} ${on ? 'hooks installed' : 'not connected'}`);
  }
  const q = path.join(emberHome(), 'queue.jsonl');
  const queued = fs.existsSync(q) ? fs.readFileSync(q, 'utf8').split('\n').filter(Boolean).length : 0;
  console.log(`queue    ${queued} heartbeat(s) waiting`);
  const err = path.join(emberHome(), 'last_error');
  if (fs.existsSync(err)) console.log(`error    ${fs.readFileSync(err, 'utf8').trim()}`);
  if (cfg.api_key) {
    try {
      const res = await fetch(`${cfg.api_url}/api/v1/me/today`, { headers: { Authorization: `Bearer ${cfg.api_key}` }, signal: AbortSignal.timeout(6000) });
      const body = res.ok ? await res.json() : null;
      console.log(`server   ${body ? `today ${body.text} as @${body.username}` : `HTTP ${res.status}`}`);
    } catch {
      console.log('server   unreachable');
    }
  }
}

function uninstall(o) {
  for (const t of ['claude', 'codex', 'cursor']) {
    try {
      const r = apply(t, { uninstall: true, env });
      console.log(`${t.padEnd(8)} ${r.changed ? 'hooks removed' : 'nothing to remove'}`);
    } catch (e) {
      console.log(`${t.padEnd(8)} skipped: ${e.message}`);
    }
  }
  for (const e of EDITORS) if (onPath(e.cli)) spawnSync(e.cli, ['--uninstall-extension', EXTENSION_ID], { stdio: 'ignore' });
  if (o.purge) {
    fs.rmSync(emberHome(), { recursive: true, force: true });
    console.log(`removed  ${emberHome()}`);
  }
}

const HELP = `embertime: track coding time across editors and AI agents

  npx embertime setup --key <ember_key> [--api-url <url>] [--vsix <file>] [--skip-editors]
  npx embertime status
  npx embertime uninstall [--purge]

setup finds VS Code, Cursor, Windsurf, VSCodium, Claude Code, Codex and Cursor's
agent on this
machine and connects each one. Re-running it is safe.`;

const o = parse(process.argv.slice(2));
const cmd = o._[0];
if (o.help || !cmd) console.log(HELP);
else if (cmd === 'setup') await setup(o);
else if (cmd === 'status') await status();
else if (cmd === 'uninstall') uninstall(o);
else {
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exit(1);
}
