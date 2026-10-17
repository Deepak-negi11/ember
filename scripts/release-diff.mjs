#!/usr/bin/env node
// What changed in shipped code between two unpacked releases, from REA's static
// analysis (https://github.com/morluto/rea): exported functions added, removed or
// changed, and network call sites per file. A new network call is what a privacy
// review must look at, so it is raised as a CI warning.
//
// Usage: node scripts/release-diff.mjs "<title>" <old dir> <new dir>
// REA_CMD overrides the REA command (default: npx -y rea-agents@6.5.0).
// Report only: exits 0 even when REA is unavailable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [title, oldDir, newDir] = process.argv.slice(2);
if (!title || !oldDir || !newDir) {
  console.error('usage: release-diff.mjs "<title>" <old dir> <new dir>');
  process.exit(64);
}
const rea = (process.env.REA_CMD || 'npx -y rea-agents@6.5.0').split(/\s+/);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-release-diff-'));

function runRea(args, outFile) {
  const r = spawnSync(rea[0], [...rea.slice(1), ...args, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`rea ${args[0]} failed: ${(r.stderr || r.error?.message || '').split('\n').slice(-3).join(' ')}`);
  fs.writeFileSync(outFile, r.stdout);
  return JSON.parse(r.stdout);
}

/** node_id -> { id: "file:export", file, name, range } for every export in an application analysis. */
function exportsById(evidence) {
  const out = new Map();
  for (const n of evidence.normalized_result.graph.nodes) {
    if (n.kind !== 'javascript-module' || n.identity?.namespace !== 'module-export') continue;
    try {
      const [, file, name] = JSON.parse(n.identity.key);
      // Functions carry their exact source offsets ("callable:function:<start>:<end>").
      const callable = n.observations?.map((o) => o.properties?.callable_id).find((c) => typeof c === 'string');
      const m = callable && /:(\d+):(\d+)$/.exec(callable);
      out.set(n.node_id, { id: `${file}:${name}`, file, name, range: m ? [Number(m[1]), Number(m[2])] : null });
    } catch {
      /* unexpected key shape: leave it out of the readable report */
    }
  }
  return out;
}

/**
 * Source text of an export: the function body REA located, or for values the
 * declaration up to the next blank line or export (a heuristic, see report note).
 */
function exportText(root, exp) {
  let src;
  try {
    src = fs.readFileSync(path.join(root, exp.file), 'utf8');
  } catch {
    return null;
  }
  if (exp.range) return src.slice(exp.range[0], exp.range[1]);
  const start = src.search(new RegExp(`export\\s+(?:const|let|var)\\s+${exp.name}\\b`));
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.search(/\n\s*\n|\nexport /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Network call sites (fetch, http(s).request, WebSocket) per file. */
function requestsByFile(evidence) {
  const out = new Map();
  for (const n of evidence.normalized_result.semantic_graph?.nodes ?? []) {
    if (n.kind !== 'request') continue;
    const file = n.identity?.module_path ?? '?';
    out.set(file, (out.get(file) ?? 0) + 1);
  }
  return out;
}

const lines = [`### ${title}`, ''];
const warnings = [];
try {
  const left = runRea(['analyze-javascript-application', path.resolve(oldDir)], path.join(work, 'left.json'));
  const right = runRea(['analyze-javascript-application', path.resolve(newDir)], path.join(work, 'right.json'));
  const input = path.join(work, 'compare-in.json');
  fs.writeFileSync(input, JSON.stringify({ left, right }));
  const cmp = runRea(['compare-application-versions', input], path.join(work, 'compare.json')).normalized_result;

  const leftNames = exportsById(left);
  const rightNames = exportsById(right);
  const removed = new Map();
  const added = new Map();
  for (const item of cmp.items) {
    const l = leftNames.get(item.left_node_id);
    const r = rightNames.get(item.right_node_id);
    if (item.status === 'removed' && l) removed.set(l.id, l);
    if (item.status === 'added' && r) added.set(r.id, r);
  }
  // REA pairs code by exact fingerprint, and a function that only moved (an edit
  // above it shifted it) also fails to pair. So an export reported as removed and
  // re-added under the same name is "changed" only if its source text differs.
  const changed = [];
  let moved = 0;
  for (const [id, r] of added) {
    if (!removed.has(id)) continue;
    const before = exportText(oldDir, removed.get(id));
    const after = exportText(newDir, r);
    if (before !== null && before === after) moved++;
    else changed.push(id);
  }
  changed.sort();
  const onlyAdded = [...added.keys()].filter((n) => !removed.has(n)).sort();
  const onlyRemoved = [...removed.keys()].filter((n) => !added.has(n)).sort();
  const list = (label, names) => names.length && lines.push(`**${label} (${names.length})**: ${names.map((n) => `\`${n}\``).join(', ')}`, '');
  list('Changed exports', changed);
  list('New exports', onlyAdded);
  list('Removed exports', onlyRemoved);
  if (!changed.length && !onlyAdded.length && !onlyRemoved.length) lines.push('No exported function changed.', '');
  if (moved) lines.push(`${moved} other export(s) only moved within their file; their code is identical.`, '');

  const before = requestsByFile(left);
  const after = requestsByFile(right);
  const files = [...new Set([...before.keys(), ...after.keys()])].sort();
  lines.push('| Network call sites | before | after |', '| --- | ---: | ---: |');
  for (const f of files) {
    const b = before.get(f) ?? 0;
    const a = after.get(f) ?? 0;
    lines.push(`| \`${f}\` | ${b} | ${a}${a > b ? ' ⚠️' : ''} |`);
    if (a > b) warnings.push(`${title}: ${f} has ${a - b} new network call site(s). Check what they send before releasing.`);
  }
  if (!files.length) lines.push('| (none) | 0 | 0 |');
  lines.push(
    '',
    '_REA static analysis: call sites, not observed traffic (the privacy test checks real payloads). ' +
      'Exported values (not functions) are compared up to the next blank line._',
  );
} catch (e) {
  lines.push(`REA comparison unavailable: ${e.message}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const report = `${lines.join('\n')}\n`;
process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
for (const w of warnings) console.log(`::warning::${w}`);
