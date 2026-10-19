// Demo data for local development: `npm run seed`.
// Creates fictional users with a year of generated heartbeats. Demo accounts
// have no linked X or Google identity, so nobody can sign in as them.
import { createHash } from "node:crypto";
import { closeDb, get, run } from "../lib/db.ts";
import { ingest, ingestUsage } from "../lib/stats.ts";
import { parseHeartbeat, type ParsedHeartbeat } from "../lib/heartbeat.ts";
import { parseUsage, type ParsedUsage } from "../lib/usage.ts";

type Persona = {
  username: string; name: string; tz: string; location: string; bio: string; quote: string; github?: string;
  intensity: number; aiShare: number;
  projects: { name: string; stack: string[]; langs: string[] }[];
};

const PERSONAS: Persona[] = [
  { username: "ishita-rawat", name: "Ishita Rawat", tz: "Asia/Kolkata", location: "Dehradun, India", intensity: 1.35, aiShare: 0.3,
    bio: "Systems programmer. Rust, compilers, and too many side projects.",
    quote: "Consistency compiles. Motivation doesn't.",
    projects: [{ name: "borrowck-viz", stack: ["Rust", "Tokio", "WebAssembly"], langs: ["Rust", "TypeScript"] }, { name: "tinyvm", stack: ["Rust"], langs: ["Rust", "Markdown"] }] },
  { username: "kenji-w", name: "Kenji Watanabe", tz: "Asia/Tokyo", location: "Osaka, Japan", intensity: 1.2, aiShare: 0.45,
    bio: "Frontend at a fintech. Typography nerd.",
    quote: "Read the error twice before you search it once.",
    projects: [{ name: "ledger-ui", stack: ["Next.js", "React", "Tailwind CSS", "TypeScript"], langs: ["TSX", "TypeScript", "CSS"] }] },
  { username: "lucia-ferrer", name: "Lucía Ferrer", tz: "Europe/Madrid", location: "Valencia, Spain", intensity: 1.05, aiShare: 0.2,
    bio: "ML engineer working on speech models.",
    quote: "If you can't reproduce it, you didn't measure it.",
    projects: [{ name: "whisper-finetune", stack: ["Python", "PyTorch", "NumPy"], langs: ["Python", "YAML"] }, { name: "eval-harness", stack: ["Python", "FastAPI"], langs: ["Python"] }] },
  { username: "rohan-bisht", name: "Rohan Bisht", tz: "Asia/Kolkata", location: "Haldwani, India", intensity: 0.95, aiShare: 0.55,
    bio: "Final-year CSE student building a campus marketplace.",
    quote: "Small commits, every day. Momentum beats motivation.",
    projects: [{ name: "campus-cart", stack: ["React Native", "Expo", "Express", "Prisma"], langs: ["TypeScript", "TSX", "Prisma"] }] },
  { username: "amara-okafor", name: "Amara Okafor", tz: "Africa/Lagos", location: "Lagos, Nigeria", intensity: 0.9, aiShare: 0.15,
    bio: "Backend and infra. Go and Postgres all day.",
    quote: "",
    projects: [{ name: "payroute", stack: ["Go", "Gin", "Docker"], langs: ["Go", "SQL", "Dockerfile"] }] },
  { username: "tomasz-nowak", name: "Tomasz Nowak", tz: "Europe/Warsaw", location: "Kraków, Poland", intensity: 0.8, aiShare: 0.35,
    bio: "Game dev hobbyist, Bevy contributor.",
    quote: "Profile first. Your guess is usually wrong.",
    projects: [{ name: "voxel-garden", stack: ["Rust", "Bevy"], langs: ["Rust", "WGSL"] }] },
  { username: "priya-nair", name: "Priya Nair", tz: "Asia/Kolkata", location: "Kochi, India", intensity: 0.75, aiShare: 0.4,
    bio: "Android and Flutter.",
    quote: "Tests are permission to delete code.",
    projects: [{ name: "habitly", stack: ["Flutter", "Dart"], langs: ["Dart", "Kotlin"] }] },
  { username: "felix-schroeder", name: "Felix Schröder", tz: "Europe/Berlin", location: "Hamburg, Germany", intensity: 0.65, aiShare: 0.6,
    bio: "Platform engineer. Kubernetes whisperer.",
    quote: "",
    projects: [{ name: "kube-cost", stack: ["Go", "Docker"], langs: ["Go", "YAML"] }, { name: "dashboards", stack: ["Vue", "Vite", "TypeScript"], langs: ["Vue", "TypeScript"] }] },
  { username: "sana-qureshi", name: "Sana Qureshi", tz: "Asia/Karachi", location: "Lahore, Pakistan", intensity: 0.55, aiShare: 0.25,
    bio: "Django and data pipelines.",
    quote: "Name things for whoever joins next year.",
    projects: [{ name: "clinic-records", stack: ["Python", "Django"], langs: ["Python", "HTML"] }] },
  { username: "mateo-rossi", name: "Mateo Rossi", tz: "Europe/Rome", location: "Turin, Italy", intensity: 0.45, aiShare: 0.5,
    bio: "Indie hacker. Svelte fan.",
    quote: "",
    projects: [{ name: "tabletop-tools", stack: ["SvelteKit", "Svelte", "Tailwind CSS"], langs: ["Svelte", "TypeScript"] }] },
];

const EDITORS = ["vscode", "cursor"];
const AGENTS = ["claude-code", "codex"];
const MODELS: Record<string, string[]> = {
  "claude-code": ["claude-opus-5-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  codex: ["gpt-6-sol", "gpt-5.3-codex", "gpt-6-luna"],
};

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

function beatsForDay(p: Persona, dayStart: number, now: number): { beats: ParsedHeartbeat[]; usage: ParsedUsage[] } {
  const out: ParsedHeartbeat[] = [];
  const usage: ParsedUsage[] = [];
  const dow = new Date(dayStart * 1000).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  if (rand() > (weekend ? 0.45 : 0.85) * Math.min(1, p.intensity)) return { beats: out, usage };

  const sessions = 1 + Math.floor(rand() * 3 * p.intensity);
  const editor = pick(EDITORS);
  for (let s = 0; s < sessions; s++) {
    const proj = pick(p.projects);
    const ai = rand() < p.aiShare;
    const agent = pick(AGENTS);
    let t = dayStart + (8 + rand() * 14) * 3600;
    const length = (15 + rand() * 120 * p.intensity) * 60;
    const stop = t + length;
    while (t < stop && t < now) {
      const hb = parseHeartbeat({
        time: t, project: proj.name, language: pick(proj.langs), editor: ai ? agent : editor,
        category: ai ? "ai" : "coding", stack: proj.stack, branch: "main", is_write: true,
      }, now);
      if (hb) out.push(hb);
      // An agent turn ends every few minutes; each reports the tokens it used.
      if (ai && rand() < 0.35) {
        const scale = 0.4 + rand() * 1.6;
        const u = parseUsage({
          id: createHash("sha1").update(`${p.username}:${t}`).digest("hex"), time: t, agent, model: pick(MODELS[agent]),
          input: Math.round(1_500 * scale), output: Math.round(4_000 * scale),
          cache_read: Math.round(180_000 * scale), cache_write: Math.round(22_000 * scale),
        }, now);
        if (u) usage.push(u);
      }
      t += 60 + rand() * 240;
    }
  }
  return { beats: out, usage };
}

const now = Math.floor(Date.now() / 1000);
let users = 0;
let beats = 0;
for (const p of PERSONAS) {
  if (await get("SELECT 1 AS x FROM users WHERE username = ?", p.username)) continue;
  const res = await run(
    `INSERT INTO users (username, display_name, bio, quote, github, location, timezone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    p.username, p.name, p.bio, p.quote, p.github ?? "", p.location, p.tz, now - 400 * 86400);
  const uid = Number(res.lastInsertRowid);
  users++;
  for (let d = 360; d >= 0; d--) {
    const dayStart = Math.floor((now - d * 86400) / 86400) * 86400;
    const day = beatsForDay(p, dayStart, now);
    if (day.beats.length) {
      await ingest(uid, p.tz, day.beats);
      beats += day.beats.length;
    }
    if (day.usage.length) await ingestUsage(uid, p.tz, day.usage);
  }
}
console.log(`Seeded ${users} demo users and ${beats.toLocaleString()} heartbeats.`);
await closeDb();
