import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { detectStack, StackCache } from '../src/stack';
import { tempProject } from './helpers';

const pkg = (deps: Record<string, string>, devDeps: Record<string, string> = {}) =>
  JSON.stringify({ dependencies: deps, devDependencies: devDeps });

test('Next.js + Tailwind + TypeScript project', () => {
  const dir = tempProject({
    'package.json': pkg({ next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0' }, { tailwindcss: '4', typescript: '5' }),
  });
  assert.deepEqual(detectStack(dir), ['Next.js', 'React', 'Tailwind CSS', 'TypeScript']);
});

test('npm ecosystem coverage', () => {
  const cases: [Record<string, string>, string[]][] = [
    [{ nuxt: '3', vue: '3' }, ['Nuxt', 'Vue']],
    [{ '@sveltejs/kit': '2', svelte: '4', vite: '5' }, ['SvelteKit', 'Svelte', 'Vite']],
    [{ '@angular/core': '17' }, ['Angular']],
    [{ express: '4', prisma: '5' }, ['Express', 'Prisma']],
    [{ '@nestjs/core': '10', '@prisma/client': '5' }, ['NestJS', 'Prisma']],
    [{ electron: '30', three: '0.160' }, ['Electron', 'Three.js']],
    [{ 'react-native': '0.74', expo: '51', react: '18' }, ['React', 'React Native', 'Expo']],
    [{ astro: '4', 'solid-js': '1' }, ['Astro', 'SolidJS']],
    [{ '@remix-run/node': '2', hono: '4', fastify: '4' }, ['Remix', 'Fastify', 'Hono']],
  ];
  for (const [deps, expected] of cases) {
    assert.deepEqual(detectStack(tempProject({ 'package.json': pkg(deps) })), expected, JSON.stringify(deps));
  }
  // tsconfig.json alone implies TypeScript
  assert.deepEqual(detectStack(tempProject({ 'package.json': pkg({}), 'tsconfig.json': '{}' })), ['TypeScript']);
});

test('Rust, including Tauri in src-tauri/', () => {
  assert.deepEqual(
    detectStack(tempProject({ 'Cargo.toml': '[package]\nname="x"\n[dependencies]\naxum = "0.7"\ntokio = { version = "1" }\n' })),
    ['Axum', 'Tokio', 'Rust'],
  );
  assert.deepEqual(detectStack(tempProject({ 'Cargo.toml': '[dependencies.bevy]\nversion = "0.13"\n' })), ['Bevy', 'Rust']);
  assert.deepEqual(detectStack(tempProject({ 'Cargo.toml': '[dependencies]\nactix-web = "4"\n' })), ['Actix', 'Rust']);
  assert.deepEqual(
    detectStack(tempProject({ 'package.json': pkg({ react: '18' }, { vite: '5' }), 'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"\n' })),
    ['React', 'Vite', 'Tauri', 'Rust'],
  );
});

test('Python manifests', () => {
  assert.deepEqual(detectStack(tempProject({ 'requirements.txt': 'Django==5.0\npandas>=2\nnumpy\n' })), ['Django', 'pandas', 'NumPy', 'Python']);
  assert.deepEqual(
    detectStack(tempProject({ 'pyproject.toml': '[project]\ndependencies = ["fastapi[standard]>=0.110", "torchvision"]\n' })),
    ['FastAPI', 'Python'],
    'torchvision must not count as torch',
  );
  assert.deepEqual(
    detectStack(tempProject({ 'pyproject.toml': '[tool.poetry.dependencies]\nflask = "^3"\ntorch = "^2"\ntensorflow = "*"\n' })),
    ['Flask', 'PyTorch', 'TensorFlow', 'Python'],
  );
});

test('Go, JVM, Ruby, PHP, Dart, .NET, C++, Docker', () => {
  assert.deepEqual(detectStack(tempProject({ 'go.mod': 'module m\nrequire (\n github.com/gin-gonic/gin v1\n github.com/gofiber/fiber/v2 v2\n)\n' })), ['Gin', 'Fiber', 'Go']);
  assert.deepEqual(detectStack(tempProject({ 'pom.xml': '<groupId>org.springframework.boot</groupId>' })), ['Spring', 'Java']);
  assert.deepEqual(detectStack(tempProject({ 'build.gradle': "plugins { id 'java' }" })), ['Java']);
  assert.deepEqual(detectStack(tempProject({ 'build.gradle.kts': 'plugins { kotlin("jvm") version "2.0.0" }' })), ['Kotlin']);
  assert.deepEqual(detectStack(tempProject({ Gemfile: 'gem "rails", "~> 7.1"\n' })), ['Rails', 'Ruby']);
  assert.deepEqual(detectStack(tempProject({ 'composer.json': '{"require":{"laravel/framework":"^11.0"}}' })), ['Laravel', 'PHP']);
  assert.deepEqual(detectStack(tempProject({ 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n' })), ['Flutter', 'Dart']);
  assert.deepEqual(detectStack(tempProject({ 'pubspec.yaml': 'name: cli\n' })), ['Dart']);
  assert.deepEqual(detectStack(tempProject({ 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk"/>' })), ['C#', '.NET']);
  assert.deepEqual(detectStack(tempProject({ 'CMakeLists.txt': 'project(x CXX)' })), ['C++']);
  assert.deepEqual(detectStack(tempProject({ Dockerfile: 'FROM node:22' })), ['Docker']);
  assert.deepEqual(detectStack(tempProject({ 'compose.yaml': 'services: {}' })), ['Docker']);
});

test('polyglot repo, malformed manifests and missing dirs', () => {
  assert.deepEqual(
    detectStack(tempProject({ 'package.json': pkg({ express: '4' }), 'requirements.txt': 'flask', Dockerfile: 'FROM x' })),
    ['Express', 'Flask', 'Python', 'Docker'],
  );
  assert.deepEqual(detectStack(tempProject({ 'package.json': '{ not json' })), []);
  assert.deepEqual(detectStack(tempProject({ 'README.md': '# hi' })), []);
  assert.deepEqual(detectStack(path.join(tempProject(), 'does-not-exist')), []);
});

test('StackCache re-detects only after the TTL', () => {
  let now = 0;
  let calls = 0;
  const cache = new StackCache(10 * 60_000, () => now, () => {
    calls++;
    return ['Go'];
  });
  assert.deepEqual(cache.get('/a'), ['Go']);
  now += 9 * 60_000;
  cache.get('/a');
  assert.equal(calls, 1);
  cache.get('/b');
  assert.equal(calls, 2);
  now += 2 * 60_000;
  cache.get('/a');
  assert.equal(calls, 3);
});
