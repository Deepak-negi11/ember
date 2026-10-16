// Git root and branch detection by reading .git directly (no git CLI).
import * as fs from 'fs';
import * as path from 'path';

/** Walk up from `start` to the first directory containing `.git` (a dir, or a file for worktrees/submodules). */
export function findGitRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Current branch from HEAD; undefined when detached or unreadable. */
export function readBranch(gitRoot: string): string | undefined {
  try {
    let gitDir = path.join(gitRoot, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return undefined;
      gitDir = path.resolve(gitRoot, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return ref ? ref[1] : undefined;
  } catch {
    return undefined;
  }
}
