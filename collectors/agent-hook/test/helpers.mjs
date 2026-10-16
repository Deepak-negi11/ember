// Shared test helpers: temp dirs, fake git repos and a tiny Ember API server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const created = [];
process.on('exit', () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/** Fresh temp dir (realpath'd so macOS /var -> /private/var doesn't break comparisons); removed on exit. */
export function tmpDir(prefix = 'ember-test-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Create a fake repo: <root>/.git/HEAD plus optional files. */
export function makeRepo(root, { branch = 'main', head, files = {} } = {}) {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), head ?? `ref: refs/heads/${branch}\n`);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

/**
 * Start a fake API server on port 0. `respond(req, body)` returns [status, json].
 * Records every request in `requests`.
 */
export async function startServer(respond = () => [202, { accepted: 0, duplicates: 0 }]) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(data);
      } catch {
        /* not json */
      }
      const entry = { method: req.method, url: req.url, headers: req.headers, body, raw: data };
      requests.push(entry);
      const [status, json] = respond(entry);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Environment for child processes that can never touch the real home directory. */
export function isolatedEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, EMBER_HOME: path.join(home, '.ember'), ...extra };
  delete env.CODEX_HOME;
  delete env.EMBER_API_KEY;
  delete env.EMBER_API_URL;
  return { ...env, ...extra };
}

export const KEY = `ember_${'a1'.repeat(20)}`;
