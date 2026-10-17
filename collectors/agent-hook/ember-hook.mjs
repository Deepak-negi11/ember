#!/usr/bin/env node
// Ember agent hook: records AI-agent activity (Claude Code, Codex CLI, Cursor Agent) as
// Ember heartbeats.
//
// Usage:  node ember-hook.mjs --agent claude-code|codex|cursor-agent   (hook JSON on stdin)
//
// Guarantees:
//   * zero dependencies, Node >= 18, ESM
//   * never writes to stdout for Claude Code / Codex (they may interpret it); for
//     Cursor it prints the minimal JSON reply Cursor expects. Always exits 0
//   * never sends file contents, raw paths or prompt text: files are reduced
//     to an HMAC of the absolute path, keyed with a random per-machine secret
//     (~/.ember/entity.key), and the project to the git root's basename
//   * heartbeats are appended to ~/.ember/queue.jsonl before any network I/O,
//     so nothing is lost when the server is down
//
// Environment overrides: EMBER_HOME (default ~/.ember), EMBER_API_URL, EMBER_API_KEY.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.4';
export const AGENTS = ['claude-code', 'codex', 'cursor-agent'];

/** Events whose heartbeats are throttled: they fire on every tool call or file edit. */
const HIGH_FREQUENCY_EVENTS = new Set(['PostToolUse', 'afterFileEdit']);
export const DEFAULT_API_URL = 'https://ember-dev.vercel.app';

const QUEUE_CAP = 20_000; // max lines kept in queue.jsonl (oldest dropped)
const BATCH_SIZE = 500; // server maximum per request
const FETCH_TIMEOUT_MS = 2_500;
const FLUSH_BUDGET_MS = 6_000; // stop starting new batches after this long
const MAX_BATCHES_PER_RUN = 10;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 1_000;
const STDIN_TIMEOUT_MS = 1_000;
const THROTTLE_SECONDS = 30;
const BACKOFF_MIN_S = 30;
const BACKOFF_MAX_S = 600;
const LOG_MAX_BYTES = 1024 * 1024;
const HARD_EXIT_MS = 9_000; // absolute safety net for the whole process

// ---------------------------------------------------------------------------
// Paths and config
// ---------------------------------------------------------------------------

export function emberHome(env = process.env) {
  return env.EMBER_HOME || path.join(os.homedir(), '.ember');
}

function paths(home) {
  return {
    config: path.join(home, 'config.json'),
    queue: path.join(home, 'queue.jsonl'),
    inflight: path.join(home, 'queue.inflight.jsonl'),
    lock: path.join(home, 'queue.lock'),
    state: path.join(home, 'hook-state.json'),
    log: path.join(home, 'hook.log'),
    lastError: path.join(home, 'last_error'),
    entityKey: path.join(home, 'entity.key'),
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Resolve API URL + key: env overrides win over ~/.ember/config.json. */
export function loadConfig(home, env = process.env) {
  const cfg = readJson(paths(home).config, {}) || {};
  const apiUrl = String(env.EMBER_API_URL || cfg.api_url || DEFAULT_API_URL).replace(/\/+$/, '');
  const apiKey = env.EMBER_API_KEY || cfg.api_key || '';
  return { apiUrl, apiKey };
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Logging (to ~/.ember/hook.log, rotated at 1 MB; never stdout)
// ---------------------------------------------------------------------------

export function log(home, level, message) {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const file = paths(home).log;
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      /* no log yet */
    }
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch {
    /* logging must never fail the hook */
  }
}

// ---------------------------------------------------------------------------
// Git: root, project name, branch (reads .git/HEAD directly, no git CLI)
// ---------------------------------------------------------------------------

/** Walk up from `start` until a directory containing `.git` (dir or file) is found. */
export function findGitRoot(start) {
  if (!start) return null;
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Branch name from HEAD, or undefined for detached HEAD / unreadable repos. */
export function readBranch(gitRoot) {
  try {
    let gitDir = path.join(gitRoot, '.git');
    if (fs.statSync(gitDir).isFile()) {
      // Worktrees and submodules: ".git" is a file containing "gitdir: <path>".
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

// ---------------------------------------------------------------------------
// Language by file extension
// ---------------------------------------------------------------------------

const LANGUAGE_BY_EXT = {
  '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.tsx': 'TSX',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JSX',
  '.py': 'Python', '.pyi': 'Python', '.ipynb': 'Jupyter Notebook',
  '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.swift': 'Swift', '.m': 'Objective-C', '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
  '.cs': 'C#', '.fs': 'F#', '.rb': 'Ruby', '.php': 'PHP', '.dart': 'Dart',
  '.scala': 'Scala', '.lua': 'Lua', '.pl': 'Perl', '.r': 'R', '.jl': 'Julia',
  '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.hs': 'Haskell',
  '.clj': 'Clojure', '.ml': 'OCaml', '.zig': 'Zig', '.nim': 'Nim',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.fish': 'Shell', '.ps1': 'PowerShell',
  '.sql': 'SQL', '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.sass': 'Sass', '.less': 'Less', '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
  '.json': 'JSON', '.jsonc': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.xml': 'XML', '.md': 'Markdown', '.mdx': 'MDX', '.tf': 'HCL', '.proto': 'Protocol Buffers',
  '.graphql': 'GraphQL', '.gql': 'GraphQL', '.prisma': 'Prisma', '.sol': 'Solidity',
};

const LANGUAGE_BY_BASENAME = {
  dockerfile: 'Docker', makefile: 'Makefile', 'cmakelists.txt': 'CMake', gemfile: 'Ruby',
};

export function languageForPath(file) {
  const base = path.basename(file).toLowerCase();
  if (LANGUAGE_BY_BASENAME[base]) return LANGUAGE_BY_BASENAME[base];
  if (base.startsWith('dockerfile')) return 'Docker';
  return LANGUAGE_BY_EXT[path.extname(base)];
}

// ---------------------------------------------------------------------------
// Tech-stack detection (dependency-free copy of extensions/vscode/src/stack.ts)
// ---------------------------------------------------------------------------

// Order matters: frameworks first, languages last (e.g. Next.js, React, Tailwind CSS, TypeScript).
const NPM_STACK = [
  { label: 'Next.js', deps: ['next'] },
  { label: 'Nuxt', deps: ['nuxt'] },
  { label: 'SvelteKit', deps: ['@sveltejs/kit'] },
  { label: 'Astro', deps: ['astro'] },
  { label: 'Remix', prefixes: ['@remix-run/'] },
  { label: 'React', deps: ['react'] },
  { label: 'React Native', deps: ['react-native'] },
  { label: 'Expo', deps: ['expo'] },
  { label: 'Vue', deps: ['vue'] },
  { label: 'Svelte', deps: ['svelte'] },
  { label: 'Angular', deps: ['@angular/core', 'angular'] },
  { label: 'SolidJS', deps: ['solid-js'] },
  { label: 'Electron', deps: ['electron'] },
  { label: 'Three.js', deps: ['three'] },
  { label: 'Express', deps: ['express'] },
  { label: 'NestJS', deps: ['@nestjs/core', 'nestjs'] },
  { label: 'Fastify', deps: ['fastify'] },
  { label: 'Hono', deps: ['hono'] },
  { label: 'Prisma', deps: ['prisma', '@prisma/client'] },
  { label: 'Tailwind CSS', deps: ['tailwindcss'] },
  { label: 'Vite', deps: ['vite'] },
  { label: 'TypeScript', deps: ['typescript'] },
];

const PYTHON_STACK = [
  ['django', 'Django'], ['flask', 'Flask'], ['fastapi', 'FastAPI'], ['torch', 'PyTorch'],
  ['tensorflow', 'TensorFlow'], ['pandas', 'pandas'], ['numpy', 'NumPy'],
];
const PYTHON_FILES = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];

const RUST_STACK = [
  ['axum', 'Axum'], ['actix-web', 'Actix'], ['bevy', 'Bevy'], ['tauri', 'Tauri'], ['tokio', 'Tokio'],
];

function readText(dir, name) {
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  } catch {
    return null;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Python dependency mentioned as a requirement / pyproject entry (not a substring like "torchvision"). */
function hasPythonDep(text, name) {
  return new RegExp(`(^|[\\s"'\\[,])${escapeRe(name)}(?=$|[\\s"'=<>~!\\[;,@])`, 'im').test(text);
}

/** Cargo dependency: `name = ...` or `[dependencies.name]`. */
function hasCargoDep(text, name) {
  return new RegExp(`^\\s*(?:\\[[\\w.-]*dependencies\\.)?${escapeRe(name)}\\s*[=\\]]`, 'm').test(text);
}

/**
 * Detect the tech stack of a project directory by inspecting manifest files
 * in that directory only (no recursion). Returns display names, deduplicated.
 */
export function detectStack(dir) {
  const out = [];
  const add = (label) => {
    if (!out.includes(label)) out.push(label);
  };
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  const has = (name) => entries.includes(name);

  // JavaScript / TypeScript
  const pkgText = readText(dir, 'package.json');
  if (pkgText) {
    let pkg = {};
    try {
      pkg = JSON.parse(pkgText) || {};
    } catch {
      /* malformed package.json */
    }
    const deps = Object.keys({
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    });
    for (const entry of NPM_STACK) {
      const hit =
        (entry.deps || []).some((d) => deps.includes(d)) ||
        (entry.prefixes || []).some((p) => deps.some((d) => d.startsWith(p)));
      if (hit) add(entry.label);
    }
  }
  if (has('tsconfig.json')) add('TypeScript');

  // Rust (including Tauri apps whose Rust side lives in src-tauri/)
  const cargo = readText(dir, 'Cargo.toml');
  if (cargo !== null) {
    for (const [dep, label] of RUST_STACK) if (hasCargoDep(cargo, dep)) add(label);
    add('Rust');
  }
  if (readText(path.join(dir, 'src-tauri'), 'Cargo.toml') !== null) {
    add('Tauri');
    add('Rust');
  }

  // Python
  const pyTexts = PYTHON_FILES.map((f) => readText(dir, f)).filter((t) => t !== null);
  if (pyTexts.length) {
    const all = pyTexts.join('\n');
    for (const [dep, label] of PYTHON_STACK) if (hasPythonDep(all, dep)) add(label);
    add('Python');
  }

  // Go
  const gomod = readText(dir, 'go.mod');
  if (gomod !== null) {
    if (gomod.includes('github.com/gin-gonic/gin')) add('Gin');
    if (gomod.includes('github.com/gofiber/fiber')) add('Fiber');
    add('Go');
  }

  // JVM
  const jvm = ['pom.xml', 'build.gradle', 'build.gradle.kts']
    .map((f) => readText(dir, f))
    .filter((t) => t !== null)
    .join('\n');
  if (jvm) {
    if (/org\.springframework|spring-boot/.test(jvm)) add('Spring');
    add(/kotlin/i.test(jvm) ? 'Kotlin' : 'Java');
  }

  // Ruby
  const gemfile = readText(dir, 'Gemfile');
  if (gemfile !== null) {
    if (/^\s*gem\s+['"]rails['"]/m.test(gemfile)) add('Rails');
    add('Ruby');
  }

  // PHP
  const composer = readText(dir, 'composer.json');
  if (composer !== null) {
    if (composer.includes('"laravel/framework"')) add('Laravel');
    add('PHP');
  }

  // Dart / Flutter
  const pubspec = readText(dir, 'pubspec.yaml');
  if (pubspec !== null) {
    if (/^\s*flutter\s*:/m.test(pubspec)) add('Flutter');
    add('Dart');
  }

  // .NET
  if (entries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln'))) {
    add('C#');
    add('.NET');
  }

  // C++
  if (has('CMakeLists.txt')) add('C++');

  // Docker
  if (
    entries.some((e) => /^dockerfile/i.test(e)) ||
    ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].some(has)
  ) {
    add('Docker');
  }

  return out;
}

// ---------------------------------------------------------------------------
// Hook payload -> heartbeat
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit', 'apply_patch', 'applypatch']);

export function isWriteTool(toolName) {
  return typeof toolName === 'string' && WRITE_TOOLS.has(toolName.toLowerCase());
}

/** All file paths named in an apply_patch body ("*** Update File: path", Add/Delete/Move to). */
export function parseApplyPatchPaths(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const re = /^\*\*\* (?:Update File|Add File|Delete File|Move to):\s*(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/** Collect strings that look like patches from an arbitrarily shaped tool_input. */
function patchTexts(value, depth = 0) {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') return value.includes('*** ') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((v) => patchTexts(v, depth + 1));
  if (typeof value === 'object') return Object.values(value).flatMap((v) => patchTexts(v, depth + 1));
  return [];
}

/**
 * Absolute path of the file a tool touched, if any. Uses explicit path fields
 * first (Claude's Write/Edit/Read/NotebookEdit), then apply_patch text (Codex).
 * `path` alone is deliberately ignored: for Grep/Glob it is a directory.
 */
export function extractFilePath(toolInput, cwd) {
  if (toolInput == null) return undefined;
  let p;
  if (typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    for (const key of ['file_path', 'notebook_path', 'filePath']) {
      if (typeof toolInput[key] === 'string' && toolInput[key].trim()) {
        p = toolInput[key].trim();
        break;
      }
    }
  }
  if (!p) {
    for (const text of patchTexts(toolInput)) {
      const found = parseApplyPatchPaths(text)[0];
      if (found) {
        p = found;
        break;
      }
    }
  }
  if (!p) return undefined;
  return path.resolve(cwd || process.cwd(), p);
}

/**
 * File identity sent as `entity`: HMAC-SHA256 of the absolute path under the
 * per-machine key, cut to the 40 hex characters the server accepts. A plain hash
 * of a path could be reversed by guessing likely paths; without the key it can't.
 */
export function entityHash(key, file) {
  return crypto.createHmac('sha256', key).update(file).digest('hex').slice(0, 40);
}

const ENTITY_KEY_RE = /^[a-f0-9]{64}$/;

function readEntityKey(file) {
  try {
    const key = fs.readFileSync(file, 'utf8').trim();
    return ENTITY_KEY_RE.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The random key shared by every collector on this machine (mode 0600), created
 * on first use. Concurrent first runs agree on one key: the first hard link wins.
 * If it can't be stored, a one-off key is used: entities then differ between runs,
 * which only weakens de-duplication, never privacy.
 */
export function loadEntityKey(home) {
  const file = paths(home).entityKey;
  const existing = readEntityKey(file);
  if (existing) return existing;
  const key = crypto.randomBytes(32).toString('hex');
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
    try {
      fs.linkSync(tmp, file);
      return key;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const winner = readEntityKey(file);
      if (winner) return winner;
      fs.renameSync(tmp, file); // existing file is corrupt: replace it
      return key;
    }
  } catch (e) {
    log(home, 'warn', `could not store entity key: ${e.message}`);
    return key;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function parsePayload(text) {
  if (!text || !text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Build exactly one heartbeat from a hook payload. Only derived, non-sensitive
 * fields are copied: never prompt text, tool output, file contents or paths.
 */
export function buildHeartbeat(payload, { agent, now = Date.now() / 1000, env = process.env, entityKey } = {}) {
  // Claude Code and Codex send `cwd`; Cursor sends `workspace_roots` (and sets CURSOR_PROJECT_DIR).
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots.filter((r) => typeof r === 'string' && r) : [];
  const cwd =
    (typeof payload.cwd === 'string' && payload.cwd) || roots[0] || env.CURSOR_PROJECT_DIR || process.cwd();
  const root = findGitRoot(cwd);
  const projectDir = root || path.resolve(cwd);
  const hb = {
    time: now,
    project: path.basename(projectDir) || 'unknown',
    editor: agent,
    category: 'ai',
    is_write: isWriteTool(payload.tool_name) || payload.hook_event_name === 'afterFileEdit',
  };
  if (root) {
    const branch = readBranch(root);
    if (branch) hb.branch = branch;
  }
  // Cursor's afterFileEdit puts the edited file at the top level.
  const file =
    extractFilePath(payload.tool_input, cwd) ||
    (typeof payload.file_path === 'string' && payload.file_path.trim() ? path.resolve(cwd, payload.file_path.trim()) : undefined);
  if (file) {
    hb.entity = entityHash(entityKey ?? loadEntityKey(emberHome(env)), file);
    const language = languageForPath(file);
    if (language) hb.language = language;
  }
  const stack = detectStack(projectDir);
  if (stack.length) hb.stack = stack;
  return hb;
}

// ---------------------------------------------------------------------------
// State (throttle + backoff) in hook-state.json
// ---------------------------------------------------------------------------

export function readState(home) {
  const s = readJson(paths(home).state, {});
  return s && typeof s === 'object' ? { last: {}, ...s } : { last: {} };
}

export function writeState(home, state) {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    writeAtomic(paths(home).state, JSON.stringify(state));
  } catch (e) {
    log(home, 'warn', `could not write state: ${e.message}`);
  }
}

/** PostToolUse heartbeats for the same agent+project are throttled to one per 30s. */
export function shouldThrottle(state, hb, eventName) {
  if (!HIGH_FREQUENCY_EVENTS.has(eventName)) return false;
  const last = state.last?.[`${hb.editor}|${hb.project}`];
  return typeof last === 'number' && hb.time - last < THROTTLE_SECONDS;
}

// ---------------------------------------------------------------------------
// Queue with lock file
// ---------------------------------------------------------------------------
//
// queue.jsonl          pending heartbeats, one JSON per line (append-only by hooks)
// queue.inflight.jsonl lines claimed by the hook currently sending
// queue.lock           short-lived mutex around every file mutation above
//
// The lock is only held for millisecond file operations, never across the
// network. "Only one sender at a time" is enforced by the inflight file: a
// fresh inflight file means another hook is sending, so we skip; an inflight
// file older than 10s belongs to a crashed hook and is reclaimed.

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid} ${Date.now()}`);
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath); // stale: holder crashed; retry once
          continue;
        }
      } catch {
        continue; // vanished between open and stat; retry
      }
      return false;
    }
  }
  return false;
}

/** Run fn while holding queue.lock. If the lock can't be had within waitMs, run unlocked (never lose data). */
export function withLock(home, fn, waitMs = LOCK_WAIT_MS) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const lockPath = paths(home).lock;
  const start = Date.now();
  let locked = false;
  while (!(locked = tryLock(lockPath))) {
    if (Date.now() - start > waitMs) break;
    sleepSync(10);
  }
  if (!locked) log(home, 'warn', 'queue.lock busy; proceeding without lock');
  try {
    return fn(locked);
  } finally {
    if (locked) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  }
}

function readLines(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim());
  } catch {
    return [];
  }
}

function capLines(lines) {
  return lines.length > QUEUE_CAP ? lines.slice(lines.length - QUEUE_CAP) : lines;
}

function writeLines(file, lines) {
  writeAtomic(file, lines.length ? `${lines.join('\n')}\n` : '');
}

export function appendToQueue(home, heartbeat) {
  const { queue } = paths(home);
  withLock(home, () => {
    fs.appendFileSync(queue, `${JSON.stringify(heartbeat)}\n`, { mode: 0o600 });
    // Cheap size check first (a heartbeat line is always > 50 bytes); only count lines when the cap could be exceeded.
    if (fs.statSync(queue).size > QUEUE_CAP * 50) {
      const lines = readLines(queue);
      if (lines.length > QUEUE_CAP) writeLines(queue, capLines(lines));
    }
  });
}

export function queueLength(home) {
  const p = paths(home);
  return readLines(p.queue).length + readLines(p.inflight).length;
}

export async function postHeartbeats(apiUrl, apiKey, heartbeats, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    const res = await fetch(`${apiUrl}/api/v1/heartbeats`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `ember-agent-hook/${VERSION}`,
      },
      body: JSON.stringify({ heartbeats }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: '', error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || e) };
  }
}

function backoffSeconds(failures) {
  return Math.min(BACKOFF_MAX_S, BACKOFF_MIN_S * 2 ** Math.max(0, failures - 1));
}

/**
 * Send queued heartbeats in batches of 500. Returns a summary object:
 * { status: 'ok'|'skipped'|'unauthorized'|'retry'|'empty'|'no-key', sent, dropped, remaining }
 */
export async function flushQueue(home, { apiUrl, apiKey, force = false, now = Date.now() } = {}) {
  const p = paths(home);
  if (!apiKey) {
    writeLastError(home, `no API key configured (set api_key in ${p.config} or EMBER_API_KEY)`);
    return { status: 'no-key', sent: 0, dropped: 0, remaining: queueLength(home) };
  }

  const state = readState(home);
  if (!force && state.backoff && now < state.backoff.next_at) {
    return { status: 'skipped', reason: 'backoff', sent: 0, dropped: 0, remaining: queueLength(home) };
  }

  // Claim everything pending into the inflight file.
  const claimed = withLock(home, () => {
    let inflightLines = [];
    try {
      const age = now - fs.statSync(p.inflight).mtimeMs;
      if (age < LOCK_STALE_MS) return null; // another hook is sending right now
      inflightLines = readLines(p.inflight); // abandoned by a crashed hook: reclaim
    } catch {
      /* no inflight file */
    }
    const lines = inflightLines.concat(readLines(p.queue));
    if (!lines.length) {
      fs.rmSync(p.inflight, { force: true });
      return [];
    }
    writeLines(p.inflight, lines);
    writeLines(p.queue, []);
    return lines;
  });
  if (claimed === null) return { status: 'skipped', reason: 'busy', sent: 0, dropped: 0, remaining: queueLength(home) };
  if (!claimed.length) return { status: 'empty', sent: 0, dropped: 0, remaining: 0 };

  let remaining = claimed;
  let sent = 0;
  let dropped = 0;
  let status = 'ok';
  const started = Date.now();
  try {
    for (let i = 0; remaining.length && i < MAX_BATCHES_PER_RUN; i++) {
      if (Date.now() - started > FLUSH_BUDGET_MS) break;
      const batchLines = remaining.slice(0, BATCH_SIZE);
      const batch = [];
      for (const line of batchLines) {
        try {
          batch.push(JSON.parse(line));
        } catch {
          dropped++; // corrupt line: drop it
        }
      }
      const res = batch.length ? await postHeartbeats(apiUrl, apiKey, batch) : { status: 202 };
      if (res.status >= 200 && res.status < 300) {
        sent += batch.length;
      } else if (res.status === 400) {
        dropped += batch.length; // invalid: never retry
        log(home, 'warn', `server rejected batch of ${batch.length} (400): ${res.body.slice(0, 300)}`);
      } else if (res.status === 401) {
        status = 'unauthorized';
        writeLastError(home, `401 Unauthorized from ${apiUrl}: check api_key in ${p.config}`);
        log(home, 'error', `401 from ${apiUrl}; keeping ${remaining.length} queued heartbeats`);
        break;
      } else {
        status = 'retry';
        log(home, 'warn', `flush failed (${res.status || res.error}); will retry later`);
        break;
      }
      remaining = remaining.slice(batchLines.length);
      writeLines(p.inflight, remaining); // progress checkpoint (also refreshes mtime)
    }
  } finally {
    // Return unsent lines to the front of the queue, ahead of anything appended meanwhile.
    withLock(home, () => {
      const merged = capLines(remaining.concat(readLines(p.queue)));
      writeLines(p.queue, merged);
      fs.rmSync(p.inflight, { force: true });
    });
  }

  const nextState = readState(home);
  if (status === 'retry') {
    const failures = (nextState.backoff?.failures || 0) + 1;
    nextState.backoff = { failures, next_at: Date.now() + backoffSeconds(failures) * 1000 };
  } else {
    delete nextState.backoff;
  }
  writeState(home, nextState);
  if (status === 'ok') fs.rmSync(p.lastError, { force: true });

  return { status, sent, dropped, remaining: queueLength(home) };
}

function writeLastError(home, message) {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(paths(home).lastError, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  let agent;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') agent = argv[++i];
    else if (a.startsWith('--agent=')) agent = a.slice('--agent='.length);
  }
  return { agent: AGENTS.includes(agent) ? agent : undefined, rawAgent: agent };
}

/** Read all of stdin, giving up after timeoutMs (agents always close stdin, but be safe). */
export function readStdin(timeoutMs = STDIN_TIMEOUT_MS, stream = process.stdin) {
  return new Promise((resolve) => {
    if (stream.isTTY) return resolve('');
    const chunks = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeAllListeners('data');
      stream.pause();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

/** Process one hook invocation. Exported for tests; never throws. */
export async function runHook({ argv = [], env = process.env, stdinText = '' } = {}) {
  const home = emberHome(env);
  try {
    const { agent, rawAgent } = parseArgs(argv);
    if (!agent) {
      log(home, 'error', `missing or unknown --agent ${JSON.stringify(rawAgent)} (expected ${AGENTS.join('|')})`);
      return { status: 'bad-args' };
    }
    const payload = parsePayload(stdinText);
    const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
    const hb = buildHeartbeat(payload, { agent, env });
    const { apiUrl, apiKey } = loadConfig(home, env);

    // Only an agent changing a file counts as coding. Opening a session,
    // sending a prompt or reading files does not; those events just deliver
    // anything still queued.
    if (!hb.is_write) {
      await flushQueue(home, { apiUrl, apiKey });
      return { status: 'not-writing' };
    }

    const state = readState(home);
    if (shouldThrottle(state, hb, event)) return { status: 'throttled' };
    state.last = { ...(state.last || {}), [`${hb.editor}|${hb.project}`]: hb.time };
    writeState(home, state);

    appendToQueue(home, hb);
    return await flushQueue(home, { apiUrl, apiKey });
  } catch (e) {
    log(home, 'error', `hook failed: ${e?.stack || e}`);
    return { status: 'error' };
  }
}

async function main() {
  const home = emberHome();
  const bail = (e) => {
    if (e) log(home, 'error', `fatal: ${e?.stack || e}`);
    process.exit(0);
  };
  process.on('uncaughtException', bail);
  process.on('unhandledRejection', bail);
  setTimeout(() => {
    log(home, 'warn', 'hard timeout reached; exiting');
    process.exit(0);
  }, HARD_EXIT_MS).unref();

  const argv = process.argv.slice(2);
  const stdinText = await readStdin();
  await runHook({ argv, stdinText });
  const reply = cursorReply(parseArgs(argv).agent, parsePayload(stdinText));
  if (reply) process.stdout.write(reply);
  process.exit(0);
}

/**
 * Cursor reads a hook's stdout as its JSON reply. Ember only observes, so it
 * answers with the neutral reply: let the prompt continue, change nothing.
 * Claude Code and Codex get no output at all.
 */
export function cursorReply(agent, payload) {
  if (agent !== 'cursor-agent') return '';
  return payload.hook_event_name === 'beforeSubmitPrompt' ? '{"continue":true}' : '{}';
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
