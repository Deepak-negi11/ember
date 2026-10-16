import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const created: string[] = [];
process.on('exit', () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/** Fresh temp dir with the given files ({ "a/b.txt": "content" }); removed on exit. */
export function tempProject(files: Record<string, string> = {}): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ember-vscode-test-')));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}
