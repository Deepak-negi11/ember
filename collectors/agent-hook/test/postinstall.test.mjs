// postinstall refreshes an existing hook copy and leaves fresh machines alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../postinstall.mjs', import.meta.url));
const run = (emberHome) => spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, EMBER_HOME: emberHome }, encoding: 'utf8' });

test('fresh machine: does nothing and exits 0', () => {
  const home = path.join(tmpDir(), '.ember');
  const r = run(home);
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(home), false);
});

test('existing setup: replaces the old hook copy but keeps config.json', () => {
  const home = path.join(tmpDir(), '.ember');
  fs.mkdirSync(path.join(home, 'agent-hook'), { recursive: true });
  fs.writeFileSync(path.join(home, 'agent-hook', 'ember-hook.mjs'), '// old');
  fs.writeFileSync(path.join(home, 'config.json'), '{"api_key":"keep-me"}');
  const r = run(home);
  assert.equal(r.status, 0);
  assert.notEqual(fs.readFileSync(path.join(home, 'agent-hook', 'ember-hook.mjs'), 'utf8'), '// old');
  assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), '{"api_key":"keep-me"}');
});
