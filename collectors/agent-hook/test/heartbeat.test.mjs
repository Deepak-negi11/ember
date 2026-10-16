import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildHeartbeat,
  parsePayload,
  parseApplyPatchPaths,
  extractFilePath,
  findGitRoot,
  readBranch,
  detectStack,
  languageForPath,
  parseArgs,
  cursorReply,
} from '../ember-hook.mjs';
import { tmpDir, makeRepo } from './helpers.mjs';

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

test('Claude Code PostToolUse Edit payload -> heartbeat', () => {
  const root = makeRepo(path.join(tmpDir(), 'my-app'), {
    branch: 'feature/login',
    files: {
      'package.json': JSON.stringify({ dependencies: { next: '15', react: '19' }, devDependencies: { typescript: '5', tailwindcss: '4' } }),
    },
  });
  const cwd = path.join(root, 'src');
  fs.mkdirSync(cwd);
  const payload = parsePayload(
    JSON.stringify({
      session_id: 'abc',
      transcript_path: '/tmp/x.jsonl',
      cwd,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(root, 'src/app/page.tsx'), old_string: 'SECRET CODE', new_string: 'MORE SECRET' },
      tool_response: { success: true },
    }),
  );
  const hb = buildHeartbeat(payload, { agent: 'claude-code', now: 1700000000.5 });
  assert.deepEqual(hb, {
    time: 1700000000.5,
    project: 'my-app',
    editor: 'claude-code',
    category: 'ai',
    is_write: true,
    branch: 'feature/login',
    entity: sha1(path.join(root, 'src/app/page.tsx')),
    language: 'TSX',
    stack: ['Next.js', 'React', 'Tailwind CSS', 'TypeScript'],
  });
  const json = JSON.stringify(hb);
  assert.ok(!json.includes('SECRET'), 'no file contents');
  assert.ok(!json.includes(root), 'no raw paths');
});

test('relative file_path is resolved against cwd before hashing', () => {
  const root = makeRepo(path.join(tmpDir(), 'rel'));
  const hb = buildHeartbeat({ cwd: root, tool_name: 'Write', tool_input: { file_path: 'lib/a.py' } }, { agent: 'claude-code' });
  assert.equal(hb.entity, sha1(path.join(root, 'lib/a.py')));
  assert.equal(hb.language, 'Python');
});

test('UserPromptSubmit never leaks prompt text', () => {
  const root = makeRepo(path.join(tmpDir(), 'proj'));
  const hb = buildHeartbeat(
    { cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'my private prompt about api keys' },
    { agent: 'claude-code' },
  );
  assert.equal(hb.is_write, false);
  assert.equal(hb.entity, undefined);
  assert.equal(hb.language, undefined);
  assert.ok(!JSON.stringify(hb).includes('private prompt'));
});

test('Codex apply_patch payload -> heartbeat with first patched file', () => {
  const root = makeRepo(path.join(tmpDir(), 'rusty'), { branch: 'main', files: { 'Cargo.toml': '[dependencies]\ntokio = "1"\naxum = "0.7"\n' } });
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/main.rs',
    '@@',
    '-fn old() {}',
    '+fn new() {}',
    '*** Add File: src/lib.rs',
    '+pub fn x() {}',
    '*** End Patch',
  ].join('\n');
  const payload = parsePayload(
    JSON.stringify({ session_id: 's', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: patch } }),
  );
  const hb = buildHeartbeat(payload, { agent: 'codex' });
  assert.equal(hb.editor, 'codex');
  assert.equal(hb.category, 'ai');
  assert.equal(hb.is_write, true);
  assert.equal(hb.language, 'Rust');
  assert.equal(hb.entity, sha1(path.join(root, 'src/main.rs')));
  assert.deepEqual(hb.stack, ['Axum', 'Tokio', 'Rust']);
  assert.ok(!JSON.stringify(hb).includes('fn new'));
});

test('parseApplyPatchPaths handles update/add/delete/move and nested inputs', () => {
  const text = '*** Begin Patch\n*** Update File: a/b.ts\n*** Move to: a/c.ts\n*** Delete File: old.go\n*** Add File: new file.md  \n*** End Patch';
  assert.deepEqual(parseApplyPatchPaths(text), ['a/b.ts', 'a/c.ts', 'old.go', 'new file.md']);
  assert.deepEqual(parseApplyPatchPaths('no patch here'), []);
  assert.deepEqual(parseApplyPatchPaths(undefined), []);
  // patch passed as argv array, or as a bare string
  assert.equal(extractFilePath({ command: ['apply_patch', text] }, '/w'), path.resolve('/w/a/b.ts'));
  assert.equal(extractFilePath(text, '/w'), path.resolve('/w/a/b.ts'));
  // Grep-style directory "path" is ignored
  assert.equal(extractFilePath({ path: '/w/src', pattern: 'x' }, '/w'), undefined);
});

test('parsePayload tolerates garbage', () => {
  assert.deepEqual(parsePayload(''), {});
  assert.deepEqual(parsePayload('not json'), {});
  assert.deepEqual(parsePayload('[1,2]'), {});
  assert.deepEqual(parsePayload('{"cwd":"/x"}'), { cwd: '/x' });
});

test('parseArgs accepts both --agent forms and rejects unknown agents', () => {
  assert.equal(parseArgs(['--agent', 'codex']).agent, 'codex');
  assert.equal(parseArgs(['--agent=claude-code']).agent, 'claude-code');
  assert.equal(parseArgs(['--agent', 'vim']).agent, undefined);
});

test('git root + branch detection in a temp repo', () => {
  const root = makeRepo(path.join(tmpDir(), 'repo'), { branch: 'release/1.2' });
  const deep = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(findGitRoot(deep), root);
  assert.equal(readBranch(root), 'release/1.2');

  // Detached HEAD -> no branch
  const detached = makeRepo(path.join(tmpDir(), 'det'), { head: '3f2a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b\n' });
  assert.equal(readBranch(detached), undefined);

  // Worktree: .git is a file pointing at the real git dir
  const base = tmpDir();
  const gitdir = path.join(base, 'main', '.git', 'worktrees', 'wt');
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/wt-branch\n');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
  assert.equal(findGitRoot(wt), wt);
  assert.equal(readBranch(wt), 'wt-branch');

  // No repo -> project falls back to cwd basename
  const plain = path.join(tmpDir(), 'plain-dir');
  fs.mkdirSync(plain);
  const hb = buildHeartbeat({ cwd: plain }, { agent: 'codex' });
  assert.equal(hb.project, 'plain-dir');
  assert.equal(hb.branch, undefined);
});

test('detectStack covers the main ecosystems', () => {
  const mk = (files) => makeRepo(tmpDir(), { files });
  assert.deepEqual(detectStack(mk({ 'pyproject.toml': '[project]\ndependencies = ["fastapi>=0.110", "torchvision", "numpy"]\n' })), ['FastAPI', 'NumPy', 'Python']);
  assert.deepEqual(detectStack(mk({ 'requirements.txt': 'Django==5.0\ntorch\npandas>=2\n' })), ['Django', 'PyTorch', 'pandas', 'Python']);
  assert.deepEqual(detectStack(mk({ 'go.mod': 'module x\nrequire github.com/gin-gonic/gin v1.9.0\n' })), ['Gin', 'Go']);
  assert.deepEqual(detectStack(mk({ 'pom.xml': '<artifactId>spring-boot-starter</artifactId>' })), ['Spring', 'Java']);
  assert.deepEqual(detectStack(mk({ 'build.gradle.kts': 'plugins { kotlin("jvm") }' })), ['Kotlin']);
  assert.deepEqual(detectStack(mk({ Gemfile: "source 'x'\ngem 'rails', '~> 7'\n" })), ['Rails', 'Ruby']);
  assert.deepEqual(detectStack(mk({ 'composer.json': '{"require":{"laravel/framework":"^11"}}' })), ['Laravel', 'PHP']);
  assert.deepEqual(detectStack(mk({ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' })), ['Flutter', 'Dart']);
  assert.deepEqual(detectStack(mk({ 'App.csproj': '<Project/>' })), ['C#', '.NET']);
  assert.deepEqual(detectStack(mk({ 'CMakeLists.txt': 'project(x)', Dockerfile: 'FROM alpine' })), ['C++', 'Docker']);
  assert.deepEqual(
    detectStack(mk({ 'package.json': '{"dependencies":{"@remix-run/react":"2","hono":"4"}}', 'src-tauri/Cargo.toml': '[package]' })),
    ['Remix', 'Hono', 'Tauri', 'Rust'],
  );
  assert.deepEqual(detectStack(mk({ 'package.json': '{ broken' })), []);
  assert.deepEqual(detectStack(path.join(tmpDir(), 'missing')), []);
});

test('languageForPath', () => {
  assert.equal(languageForPath('/a/b.ts'), 'TypeScript');
  assert.equal(languageForPath('/a/B.PY'), 'Python');
  assert.equal(languageForPath('/a/Dockerfile.dev'), 'Docker');
  assert.equal(languageForPath('/a/Makefile'), 'Makefile');
  assert.equal(languageForPath('/a/unknown.zzz'), undefined);
});

test('cursor agent: project from workspace_roots, language and write from afterFileEdit file_path', () => {
  const root = makeRepo(path.join(tmpDir(), 'cursor-proj'), { branch: 'feat/x', files: { 'package.json': '{"dependencies":{"next":"16"}}' } });
  const hb = buildHeartbeat(
    { hook_event_name: 'afterFileEdit', workspace_roots: [root], file_path: 'src/app.tsx', edits: [{ old_string: 'secret', new_string: 'code' }] },
    { agent: 'cursor-agent', now: 1000, env: {} },
  );
  assert.equal(hb.editor, 'cursor-agent');
  assert.equal(hb.category, 'ai');
  assert.equal(hb.project, 'cursor-proj');
  assert.equal(hb.branch, 'feat/x');
  assert.equal(hb.language, 'TSX');
  assert.equal(hb.is_write, true);
  assert.equal(hb.entity, crypto.createHash('sha1').update(path.join(root, 'src/app.tsx')).digest('hex'));
  assert.ok(hb.stack.includes('Next.js'));
  // Edit contents never leave the machine.
  assert.ok(!JSON.stringify(hb).includes('secret'));
});

test('cursor agent: falls back to CURSOR_PROJECT_DIR when no workspace_roots', () => {
  const root = makeRepo(path.join(tmpDir(), 'env-proj'));
  const hb = buildHeartbeat({ hook_event_name: 'stop' }, { agent: 'cursor-agent', now: 1, env: { CURSOR_PROJECT_DIR: root } });
  assert.equal(hb.project, 'env-proj');
  assert.equal(hb.is_write, false);
});

test('cursorReply: neutral JSON for Cursor, nothing for other agents', () => {
  assert.equal(cursorReply('cursor-agent', { hook_event_name: 'beforeSubmitPrompt' }), '{"continue":true}');
  assert.equal(cursorReply('cursor-agent', { hook_event_name: 'stop' }), '{}');
  assert.equal(cursorReply('claude-code', { hook_event_name: 'UserPromptSubmit' }), '');
  assert.equal(cursorReply('codex', {}), '');
  assert.equal(parseArgs(['--agent', 'cursor-agent']).agent, 'cursor-agent');
});
