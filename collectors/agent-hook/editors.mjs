// Finds the command-line launcher of each VS Code-family editor.
//
// Most people never run "Shell Command: Install 'code' command in PATH", so
// looking only at PATH misses editors that are installed. When the command is
// not on PATH we also look inside the usual install locations.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const EDITORS = [
  { cli: 'code', name: 'VS Code', mac: 'Visual Studio Code.app', win: 'Microsoft VS Code', winBin: 'bin', linux: ['/usr/share/code/bin/code', '/snap/bin/code'] },
  { cli: 'cursor', name: 'Cursor', mac: 'Cursor.app', win: 'cursor', winBin: 'resources/app/bin', linux: ['/usr/share/cursor/bin/cursor', '/opt/Cursor/resources/app/bin/cursor'] },
  { cli: 'windsurf', name: 'Windsurf', mac: 'Windsurf.app', win: 'Windsurf', winBin: 'bin', linux: ['/usr/share/windsurf/bin/windsurf'] },
  { cli: 'codium', name: 'VSCodium', mac: 'VSCodium.app', win: 'VSCodium', winBin: 'bin', linux: ['/usr/share/codium/bin/codium', '/snap/bin/codium'] },
];

function onPath(cmd, platform) {
  const r = spawnSync(platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

/** Install locations to try for one editor, most likely first. */
export function candidates(editor, { platform = process.platform, home = '', localAppData = '' } = {}) {
  if (platform === 'darwin') {
    const bin = path.posix.join('Contents/Resources/app/bin', editor.cli);
    return ['/Applications', path.posix.join(home, 'Applications')].map((dir) => path.posix.join(dir, editor.mac, bin));
  }
  if (platform === 'win32') {
    if (!localAppData) return [];
    return [path.win32.join(localAppData, 'Programs', editor.win, ...editor.winBin.split('/'), `${editor.cli}.cmd`)];
  }
  return editor.linux;
}

/**
 * The command to run for an editor: its PATH name, the full path of an
 * installed copy, or null when the editor isn't installed.
 */
export function findEditor(editor, { platform = process.platform, home = '', localAppData = '', exists = fs.existsSync, which = onPath } = {}) {
  if (which(editor.cli, platform)) return editor.cli;
  return candidates(editor, { platform, home, localAppData }).find((p) => exists(p)) ?? null;
}

/** Runs an editor's CLI. Windows launchers are .cmd files, which need a shell. */
export function runEditor(command, args) {
  if (process.platform !== 'win32') return spawnSync(command, args, { encoding: 'utf8' });
  const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return spawnSync([command, ...args].map(quote).join(' '), { encoding: 'utf8', shell: true });
}
