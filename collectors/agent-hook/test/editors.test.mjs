// Editor discovery: PATH first, then the usual install locations per OS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDITORS, candidates, findEditor } from '../editors.mjs';

const code = EDITORS.find((e) => e.cli === 'code');
const cursor = EDITORS.find((e) => e.cli === 'cursor');
const never = () => false;

test('uses the PATH command when it exists', () => {
  assert.equal(findEditor(code, { platform: 'darwin', which: () => true, exists: never }), 'code');
});

test('macOS: finds an app in /Applications when the shell command was never installed', () => {
  const app = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  assert.equal(findEditor(code, { platform: 'darwin', home: '/Users/me', which: never, exists: (p) => p === app }), app);
});

test('macOS: also checks ~/Applications', () => {
  const app = '/Users/me/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
  assert.equal(findEditor(cursor, { platform: 'darwin', home: '/Users/me', which: never, exists: (p) => p === app }), app);
});

test('Windows: looks under %LOCALAPPDATA%\\Programs for the .cmd launcher', () => {
  const [p] = candidates(cursor, { platform: 'win32', localAppData: 'C:\\Users\\me\\AppData\\Local' });
  assert.equal(p, 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd');
  assert.deepEqual(candidates(cursor, { platform: 'win32', localAppData: '' }), []);
});

test('returns null when the editor is not installed anywhere', () => {
  assert.equal(findEditor(code, { platform: 'linux', which: never, exists: never }), null);
});
