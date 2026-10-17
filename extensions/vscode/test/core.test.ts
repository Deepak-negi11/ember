// Tests for the vscode-free modules: git, languages, editor detection, the
// heartbeat gate and the shared config file.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { findGitRoot, readBranch } from '../src/git';
import { languageName } from '../src/languages';
import { HeartbeatGate, detectEditor } from '../src/tracker';
import { readSharedConfig, validateApiKey, writeSharedConfig } from '../src/config';
import { entityHash, loadEntityKey } from '../src/entity';
import { tempProject } from './helpers';

const KEY = `ember_${'0123456789abcdef'.repeat(2)}01234567`;

test('git root walks up; branch read from HEAD (normal, detached, worktree)', () => {
  const repo = tempProject({ '.git/HEAD': 'ref: refs/heads/feat/ember\n', 'src/deep/file.ts': '' });
  assert.equal(findGitRoot(path.join(repo, 'src', 'deep')), repo);
  assert.equal(readBranch(repo), 'feat/ember');

  const detached = tempProject({ '.git/HEAD': 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3\n' });
  assert.equal(readBranch(detached), undefined);

  const main = tempProject({ '.git/worktrees/wt/HEAD': 'ref: refs/heads/hotfix\n' });
  const wt = tempProject({ '.git': `gitdir: ${path.join(main, '.git/worktrees/wt')}\n` });
  assert.equal(findGitRoot(wt), wt);
  assert.equal(readBranch(wt), 'hotfix');

  assert.equal(findGitRoot(tempProject()), undefined);
});

test('languageId -> display name, with capitalized fallback', () => {
  assert.equal(languageName('typescript'), 'TypeScript');
  assert.equal(languageName('typescriptreact'), 'TSX');
  assert.equal(languageName('javascriptreact'), 'JSX');
  assert.equal(languageName('csharp'), 'C#');
  assert.equal(languageName('shellscript'), 'Shell');
  assert.equal(languageName('gleam'), 'Gleam');
  assert.equal(languageName(''), undefined);
});

test('editor detection from appName + uriScheme', () => {
  assert.equal(detectEditor('Visual Studio Code', 'vscode'), 'vscode');
  assert.equal(detectEditor('Visual Studio Code - Insiders', 'vscode-insiders'), 'vscode');
  assert.equal(detectEditor('Cursor', 'cursor'), 'cursor');
  assert.equal(detectEditor('Windsurf', 'windsurf'), 'windsurf');
  assert.equal(detectEditor('VSCodium', 'vscodium'), 'vscodium');
  assert.equal(detectEditor('Code - OSS', 'codium'), 'vscodium');
  assert.equal(detectEditor(undefined, undefined), 'vscode');
});

test('heartbeat gate: new file, 120s same-file interval, saves always', () => {
  const gate = new HeartbeatGate();
  assert.equal(gate.shouldSend('/a.ts', 1000, false), true);
  gate.record('/a.ts', 1000);
  assert.equal(gate.shouldSend('/a.ts', 1060, false), false, 'same file within 2 min');
  assert.equal(gate.shouldSend('/a.ts', 1060, true), true, 'save always sends');
  assert.equal(gate.shouldSend('/b.ts', 1061, false), true, 'file switch sends');
  assert.equal(gate.shouldSend('/a.ts', 1120, false), true, '>= 120s later sends');
});

test('shared config: write with 0600, preserve api_url and unknown fields', () => {
  const dir = path.join(tempProject(), '.ember');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ api_url: 'https://ember.example.dev', extra: 1 }));
  const file = writeSharedConfig({ api_key: KEY }, dir);
  assert.deepEqual(readSharedConfig(dir), { api_url: 'https://ember.example.dev', extra: 1, api_key: KEY });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const fresh = path.join(tempProject(), 'nested', '.ember');
  writeSharedConfig({ api_key: KEY, api_url: 'http://localhost:3000' }, fresh);
  assert.deepEqual(readSharedConfig(fresh), { api_key: KEY, api_url: 'http://localhost:3000' });
  assert.deepEqual(readSharedConfig(path.join(tempProject(), 'none')), {});
});

test('entity: keyed 40-hex hash, one shared 0600 key file, corrupt key replaced', () => {
  const file = '/Users/someone/work/app/src/index.ts';
  const key = 'ab'.repeat(32);
  assert.match(entityHash(key, file), /^[a-f0-9]{40}$/);
  assert.notEqual(entityHash(key, file), crypto.createHash('sha1').update(file).digest('hex'));
  assert.notEqual(entityHash(key, file), entityHash('cd'.repeat(32), file));
  // The agent hook computes HMAC-SHA256(key, path)[:40] too; pin one value so both stay in sync.
  assert.equal(entityHash(key, file), crypto.createHmac('sha256', key).update(file).digest('hex').slice(0, 40));

  const dir = path.join(tempProject(), '.ember');
  const created = loadEntityKey(dir);
  assert.match(created, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(path.join(dir, 'entity.key')).mode & 0o777, 0o600);
  assert.equal(loadEntityKey(dir), created);
  assert.deepEqual(fs.readdirSync(dir), ['entity.key']);
  fs.writeFileSync(path.join(dir, 'entity.key'), 'garbage');
  assert.notEqual(loadEntityKey(dir), created);
});

test('API key validation', () => {
  assert.equal(validateApiKey(KEY), undefined);
  assert.equal(validateApiKey(`  ${KEY}  `), undefined);
  assert.match(validateApiKey('sk-123') ?? '', /start with "ember_"/);
  assert.match(validateApiKey('ember_xyz') ?? '', /40 hex/);
});
