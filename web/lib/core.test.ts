import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.EMBER_DB = path.join(mkdtempSync(path.join(tmpdir(), "ember-core-")), "test.db");
const { computeDurations, streaks, localDate, heatLevel, formatDuration } = await import("./time.ts");
const { parseHeartbeat } = await import("./heartbeat.ts");
const { closeDb, get, run } = await import("./db.ts");
after(closeDb);
const { ingest, summary, leaderboard, leaderboard24h, breakdown, forgetTimeZones } = await import("./stats.ts");

const beat = (time: number, over: Partial<{ project: string; language: string; editor: string; category: "coding" | "ai" }> = {}) => ({
  time, project: "ember", language: "TypeScript", editor: "vscode", category: "coding" as const, ...over,
});

test("durations credit gaps to the earlier beat and skip idle breaks", () => {
  const d = computeDurations([beat(0), beat(60), beat(120, { language: "CSS" }), beat(120 + 3600), beat(120 + 3660)]);
  // 0->60 TS, 60->120 TS, 120->3720 idle (skipped), 3720->3780 TS
  assert.equal(d.total, 180);
  assert.equal(d.language.get("TypeScript"), 180);
  assert.equal(d.language.get("CSS"), undefined);
});

test("editor and agent running together are not double counted", () => {
  const d = computeDurations([beat(0), beat(30, { editor: "claude-code", category: "ai" }), beat(60), beat(90, { editor: "claude-code", category: "ai" }), beat(120)]);
  assert.equal(d.total, 120);
  assert.equal(d.ai, 60);
});

test("durations are order independent", () => {
  const a = computeDurations([beat(0), beat(100), beat(200)]);
  const b = computeDurations([beat(200), beat(0), beat(100)]);
  assert.equal(a.total, b.total);
});

test("streaks", () => {
  assert.deepEqual(streaks(["2026-10-08", "2026-10-09", "2026-10-10"], "2026-10-11"), { current: 3, longest: 3 });
  assert.deepEqual(streaks(["2026-10-01", "2026-10-02", "2026-10-11"], "2026-10-11"), { current: 1, longest: 2 });
  assert.deepEqual(streaks(["2026-10-01"], "2026-10-11"), { current: 0, longest: 1 });
  assert.deepEqual(streaks([], "2026-10-11"), { current: 0, longest: 0 });
});

test("local date respects time zone", () => {
  const t = Date.UTC(2026, 9, 10, 20, 0) / 1000; // 20:00 UTC
  assert.equal(localDate(t, "UTC"), "2026-10-10");
  assert.equal(localDate(t, "Asia/Kolkata"), "2026-10-11"); // 01:30 IST next day
});

test("heat levels and formatting", () => {
  assert.deepEqual([0, 600, 3600, 3 * 3600, 5 * 3600].map(heatLevel), [0, 1, 2, 3, 4]);
  assert.equal(formatDuration(3 * 3600 + 12 * 60), "3h 12m");
  assert.equal(formatDuration(59), "0m");
});

test("parseHeartbeat rejects bad input and strips junk", () => {
  const now = 1_800_000_000;
  assert.equal(parseHeartbeat({ time: now, project: "", editor: "vscode", category: "coding" }, now), null);
  assert.equal(parseHeartbeat({ time: now + 3600, project: "x", editor: "vscode", category: "coding" }, now), null);
  assert.equal(parseHeartbeat({ time: now, project: "x", editor: "VS Code!", category: "coding" }, now), null);
  assert.equal(parseHeartbeat({ time: now, project: "x", editor: "vscode", category: "gaming" }, now), null);
  const ok = parseHeartbeat({ time: now + 0.7, project: " my\u0007 app ", editor: "Cursor", category: "ai", stack: ["Next.js", "Next.js", 3], entity: "nope" }, now);
  assert.deepEqual(ok && { ...ok }, {
    time: now, project: "my app", language: "Other", branch: "", editor: "cursor", category: "ai",
    is_write: false, stack: ["Next.js"], entity: "",
  });
});

test("ingest is idempotent and feeds summary, leaderboard and hours", async () => {
  await run("INSERT INTO users (username, display_name, created_at) VALUES ('ana','Ana',0)");
  const uid = (await get<{ id: number }>("SELECT id FROM users WHERE username='ana'"))!.id;
  const now = Math.floor(Date.now() / 1000);
  const batch = [0, 60, 120, 180].map((o) => parseHeartbeat({ time: now - 600 + o, project: "ember", language: "Rust", editor: "vscode", category: "coding", is_write: true, stack: ["Rust"] }, now)!);

  assert.deepEqual(await ingest(uid, "UTC", batch), { accepted: 4, duplicates: 0 });
  assert.deepEqual(await ingest(uid, "UTC", batch), { accepted: 0, duplicates: 4 });
  // A batch that mixes a retried beat with a new one only counts the new one.
  const mixed = [batch[3], parseHeartbeat({ time: now - 600 + 240, project: "ember", language: "Rust", editor: "vscode", category: "coding", is_write: true }, now)!];
  assert.deepEqual(await ingest(uid, "UTC", mixed), { accepted: 1, duplicates: 1 });
  // Activity without writing (file switches, an agent session that only reads) is stored but adds no time.
  const idle = [300, 360, 420].map((o) => parseHeartbeat({ time: now - 600 + o, project: "ember", language: "Rust", editor: "claude-code", category: "ai" }, now)!);
  assert.deepEqual(await ingest(uid, "UTC", idle), { accepted: 3, duplicates: 0 });

  const s = await summary(uid, "UTC");
  assert.equal(s.week, 240);
  assert.equal(s.streak.current, 1);
  const today = localDate(now, "UTC");
  assert.deepEqual(await breakdown(uid, "language", today, today), [{ name: "Rust", seconds: 240 }]);
  const lb = await leaderboard(7);
  assert.equal(lb[0].username, "ana");
  assert.equal(lb[0].top_language, "Rust");
  const hours = await get<{ s: number }>("SELECT SUM(seconds) AS s FROM daily_hours WHERE user_id = ?", uid);
  assert.equal(hours!.s, 240);
});

/** A user with `beats` heartbeats 60s apart, all ending 10 minutes ago. */
async function userWith(username: string, tz: string, beats: { n: number; category?: "coding" | "ai"; language?: string; editor?: string }[]) {
  await run("INSERT INTO users (username, display_name, timezone, created_at) VALUES (?, ?, ?, 0)", username, username, tz);
  forgetTimeZones(); // raw inserts skip the app's account code, which does this
  const uid = (await get<{ id: number }>("SELECT id FROM users WHERE username = ?", username))!.id;
  const now = Math.floor(Date.now() / 1000);
  const total = beats.reduce((a, b) => a + b.n, 0);
  let t = now - 600 - total * 60;
  const batch = [];
  for (const b of beats) {
    for (let i = 0; i < b.n; i++, t += 60) {
      batch.push(parseHeartbeat({ time: t, project: "p", language: b.language ?? "Go", editor: b.editor ?? (b.category === "ai" ? "claude-code" : "vscode"), category: b.category ?? "coding", is_write: true }, now)!);
    }
  }
  for (let i = 0; i < batch.length; i += 500) await ingest(uid, tz, batch.slice(i, i + 500));
  return uid;
}

test("leaderboards cap AI time per day and offer a hands-on view", async () => {
  // Bot: an agent left running for ~6h with no hands-on time. Dev: 2h typing + 1h of agent work.
  await userWith("bot", "UTC", [{ n: 361, category: "ai" }]);
  await userWith("dev", "UTC", [{ n: 120 }, { n: 61, category: "ai" }]);

  const all = await leaderboard(7, 100, { ranksOnly: true });
  const bot = all.find((r) => r.username === "bot")!;
  const dev = all.find((r) => r.username === "dev")!;
  assert.equal(bot.seconds, 4 * 3600, "AI time is capped at 4h a day");
  assert.equal(dev.seconds, 3 * 3600, "under the cap nothing changes");

  const handsOn = await leaderboard(7, 100, { mode: "hands-on" });
  assert.equal(handsOn.find((r) => r.username === "bot"), undefined, "agent-only time does not rank hands-on");
  assert.equal(handsOn.find((r) => r.username === "dev")!.seconds, 2 * 3600);

  // The per-language board uses the per-language AI split in daily_breakdown.
  const goHandsOn = await leaderboard(7, 100, { mode: "hands-on", language: "Go" });
  assert.deepEqual(goHandsOn.map((r) => [r.username, r.seconds]), [["dev", 2 * 3600], ["ana", 0]].filter(([, s]) => s));

  // The rolling 24h board applies the same rules from raw heartbeats.
  const day = await leaderboard24h(100, { mode: "hands-on" });
  assert.equal(day.find((r) => r.username === "dev")!.seconds, 2 * 3600);
  assert.equal((await leaderboard24h(100)).find((r) => r.username === "bot")!.seconds, 4 * 3600);
});

test("weekly boards use each user's own local days", async () => {
  // Activity 8 local days ago is outside the 7-day window for its owner's zone, whatever UTC says.
  await run("INSERT INTO users (username, display_name, timezone, created_at) VALUES ('kol','Kol','Asia/Kolkata',0)");
  forgetTimeZones();
  const uid = (await get<{ id: number }>("SELECT id FROM users WHERE username='kol'"))!.id;
  const today = localDate(Math.floor(Date.now() / 1000), "Asia/Kolkata");
  const day = (offset: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  await run("INSERT INTO daily_stats (user_id, date, seconds, ai_seconds) VALUES (?, ?, 600, 0), (?, ?, 900, 0)", uid, day(7), uid, day(6));
  const row = (await leaderboard(7, 100, { ranksOnly: true })).find((r) => r.username === "kol")!;
  assert.equal(row.seconds, 900, "day 7 back is outside; day 6 back is inside");
});
