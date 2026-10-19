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
const { ingest, ingestUsage, summary, leaderboard, aiLeaderboard, aiSummary, breakdown, forgetTimeZones } = await import("./stats.ts");
const { parseUsage, costMicros, priceFor, formatTokens, formatCost, modelName } = await import("./usage.ts");

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

  // The "Today" board is one calendar day with the same rules (the beats above
  // end 10 minutes ago, so they may straddle midnight: compare against the day's rollup).
  const today = localDate(Math.floor(Date.now() / 1000), "UTC");
  const devId = dev.user_id;
  const devToday = await get<{ seconds: number; ai_seconds: number }>("SELECT seconds, ai_seconds FROM daily_stats WHERE user_id = ? AND date = ?", devId, today);
  const day = await leaderboard(1, 100, { mode: "hands-on" });
  assert.equal(day.find((r) => r.username === "dev")?.seconds ?? 0, devToday ? devToday.seconds - devToday.ai_seconds : 0);
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

  // "Today" is the owner's own calendar day: it starts at their midnight, and yesterday drops off.
  await run("INSERT INTO daily_stats (user_id, date, seconds, ai_seconds) VALUES (?, ?, 300, 0), (?, ?, 1200, 0)", uid, day(0), uid, day(1));
  assert.equal((await leaderboard(1, 100, { ranksOnly: true })).find((r) => r.username === "kol")!.seconds, 300);
  assert.equal((await leaderboard(1, 100, { ranksOnly: true, offsetDays: 1 })).find((r) => r.username === "kol")!.seconds, 1200);
});

test("parseUsage accepts only numbers and a model id", () => {
  const now = 1_800_000_000;
  const ok = { id: "a".repeat(40), time: now, agent: "claude-code", model: "Claude-Opus-5-5", input: 10, output: 20, cache_read: 30, cache_write: 0 };
  assert.deepEqual(parseUsage(ok, now), { ...ok, model: "claude-opus-5-5" });
  assert.equal(parseUsage({ ...ok, id: "short" }, now), null);
  assert.equal(parseUsage({ ...ok, model: "/Users/me/secret" }, now), null);
  assert.equal(parseUsage({ ...ok, output: -1 }, now), null);
  assert.equal(parseUsage({ ...ok, output: 1.5 }, now), null);
  assert.equal(parseUsage({ ...ok, input: 0, output: 0, cache_read: 0 }, now), null, "all zero");
  assert.equal(parseUsage({ ...ok, cache_read: 500_000_000 }, now), null, "absurd counts");
  assert.equal(parseUsage({ ...ok, time: now + 3600 }, now), null);
});

test("estimated cost uses the longest matching price and micro-dollars", () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per MTok.
  assert.equal(costMicros("claude-opus-5-5", { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000 }), 29_200_000);
  assert.equal(priceFor("claude-opus-4-5-20251101")!.input, 5, "date suffixes match");
  assert.equal(priceFor("claude-opus-4-20250514")!.input, 15, "Opus 4 is not Opus 4.5");
  assert.equal(priceFor("gpt-5.4-mini")!.input, 0.75, "longest key wins over gpt-5.4");
  assert.equal(priceFor("gpt-5.1-codex-max")!.input, 1.25);
  assert.equal(priceFor("gpt-5.5-pro")!.output, 180);
  assert.equal(priceFor("mystery-model"), undefined);
  assert.equal(costMicros("mystery-model", { input: 5, output: 5, cache_read: 0, cache_write: 0 }), 0);
  assert.deepEqual([formatTokens(950), formatTokens(12_400), formatTokens(3_450_000), formatTokens(1_200_000_000)], ["950", "12.4K", "3.5M", "1.2B"]);
  assert.deepEqual([formatCost(0), formatCost(4_000), formatCost(12_400_000), formatCost(1_234_000_000)], ["$0", "<$0.01", "$12.40", "$1,234"]);
  assert.deepEqual([modelName("claude-opus-5-5"), modelName("claude-opus-4-20250514"), modelName("gpt-5.3-codex"), modelName("x-1")], ["Opus 5.5", "Opus 4", "GPT-5.3 Codex", "x-1"]);
});

test("token usage is idempotent, dated in the user's zone, and ranks the AI board", async () => {
  const now = Math.floor(Date.now() / 1000);
  const mk = (username: string) => run("INSERT INTO users (username, display_name, timezone, created_at) VALUES (?, ?, 'UTC', 0)", username, username);
  await mk("heavy");
  await mk("pricey");
  forgetTimeZones();
  const id = async (u: string) => (await get<{ id: number }>("SELECT id FROM users WHERE username = ?", u))!.id;
  const rec = (n: number, model: string, counts: { input?: number; output?: number; cache_read?: number; cache_write?: number }) =>
    parseUsage({ id: n.toString(16).padStart(40, "0"), time: now - 60, agent: model.startsWith("gpt") ? "codex" : "claude-code", model, input: 0, output: 0, cache_read: 0, cache_write: 0, ...counts }, now)!;

  // heavy: lots of cheap tokens. pricey: fewer tokens on an expensive model.
  const heavy = [rec(1, "claude-haiku-5-5", { cache_read: 9_000_000, output: 100_000 }), rec(2, "gpt-6-luna", { input: 500_000, output: 50_000 })];
  assert.deepEqual(await ingestUsage(await id("heavy"), "UTC", heavy), { accepted: 2, duplicates: 0 });
  assert.deepEqual(await ingestUsage(await id("heavy"), "UTC", heavy), { accepted: 0, duplicates: 2 }, "a retried send is ignored");
  await ingestUsage(await id("pricey"), "UTC", [rec(3, "claude-fable-5-1", { input: 200_000, output: 300_000 })]);

  const byTokens = (await aiLeaderboard(1, 100)).map((r) => r.username);
  assert.ok(byTokens.indexOf("heavy") < byTokens.indexOf("pricey"));
  const byCost = (await aiLeaderboard(1, 100, { sort: "cost" })).map((r) => r.username);
  assert.ok(byCost.indexOf("pricey") < byCost.indexOf("heavy"));

  const row = (await aiLeaderboard(7, 100)).find((r) => r.username === "heavy")!;
  assert.equal(row.tokens, 9_650_000);
  assert.deepEqual(row.models.map((m) => m.name), ["claude-haiku-5-5", "gpt-6-luna"]);
  assert.deepEqual(row.agents, ["claude-code", "codex"]);
  // Haiku 5.5: 9M cache reads x $0.01 + 100K out x $0.50; Luna: 500K in x $0.10 + 50K out x $0.50.
  assert.equal(row.cost_micros, 90_000 + 50_000 + 50_000 + 25_000);

  // Agent time alone (Cursor's agent sends no tokens) still counts on the board.
  assert.ok((await aiLeaderboard(7, 100, { sort: "time" })).some((r) => r.username === "bot"));

  const today = localDate(now - 60, "UTC");
  const s = await aiSummary(await id("heavy"), "UTC", today, today);
  assert.equal(s.range.tokens, 9_650_000);
  assert.equal(s.today.cost_micros, 215_000);
  assert.equal(s.allTime.tokens, 9_650_000);
  assert.deepEqual(s.range.agents.map((a) => a.name), ["claude-code", "codex"]);
  assert.ok(s.range.models.every((m) => m.priced));
});
