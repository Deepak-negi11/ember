// Tech-stack detection from project manifest files. Pure (fs only, no vscode),
// so it is unit-tested directly. A dependency-free JS copy lives in
// collectors/agent-hook/ember-hook.mjs; keep the two in sync.
import * as fs from 'fs';
import * as path from 'path';

interface NpmRule {
  label: string;
  deps?: string[];
  prefixes?: string[];
}

// Order matters: frameworks first, languages last (e.g. Next.js, React, Tailwind CSS, TypeScript).
const NPM_STACK: NpmRule[] = [
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

const PYTHON_STACK: [string, string][] = [
  ['django', 'Django'],
  ['flask', 'Flask'],
  ['fastapi', 'FastAPI'],
  ['torch', 'PyTorch'],
  ['tensorflow', 'TensorFlow'],
  ['pandas', 'pandas'],
  ['numpy', 'NumPy'],
];
const PYTHON_FILES = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'];

const RUST_STACK: [string, string][] = [
  ['axum', 'Axum'],
  ['actix-web', 'Actix'],
  ['bevy', 'Bevy'],
  ['tauri', 'Tauri'],
  ['tokio', 'Tokio'],
];

function readText(dir: string, name: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A Python requirement / pyproject entry named exactly `name` (so "torchvision" is not "torch"). */
function hasPythonDep(text: string, name: string): boolean {
  return new RegExp(`(^|[\\s"'\\[,])${escapeRe(name)}(?=$|[\\s"'=<>~!\\[;,@])`, 'im').test(text);
}

/** Cargo dependency: `name = ...` or `[dependencies.name]`. */
function hasCargoDep(text: string, name: string): boolean {
  return new RegExp(`^\\s*(?:\\[[\\w.-]*dependencies\\.)?${escapeRe(name)}\\s*[=\\]]`, 'm').test(text);
}

/**
 * Detect the tech stack of `dir` from the manifests directly inside it (no
 * recursion, apart from src-tauri/ for Tauri apps). Returns display names,
 * deduplicated, frameworks before languages.
 */
export function detectStack(dir: string): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  const has = (name: string) => entries.includes(name);

  // JavaScript / TypeScript
  const pkgText = readText(dir, 'package.json');
  if (pkgText) {
    let pkg: Record<string, unknown> = {};
    try {
      pkg = JSON.parse(pkgText) ?? {};
    } catch {
      /* malformed package.json */
    }
    const section = (k: string) => (pkg[k] && typeof pkg[k] === 'object' ? (pkg[k] as Record<string, unknown>) : {});
    const deps = Object.keys({ ...section('dependencies'), ...section('devDependencies'), ...section('peerDependencies') });
    for (const rule of NPM_STACK) {
      const hit =
        (rule.deps ?? []).some((d) => deps.includes(d)) ||
        (rule.prefixes ?? []).some((p) => deps.some((d) => d.startsWith(p)));
      if (hit) add(rule.label);
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
  const pyTexts = PYTHON_FILES.map((f) => readText(dir, f)).filter((t): t is string => t !== null);
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
    .filter((t): t is string => t !== null)
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

/** Per-root cache so manifests are re-read at most every `ttlMs` (default 10 minutes). */
export class StackCache {
  private entries = new Map<string, { at: number; stack: string[] }>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
    private readonly detect: (dir: string) => string[] = detectStack,
  ) {}

  get(root: string): string[] {
    const hit = this.entries.get(root);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.stack;
    const stack = this.detect(root);
    this.entries.set(root, { at: this.now(), stack });
    return stack;
  }

  clear(): void {
    this.entries.clear();
  }
}
