import { all, get, tx, type Param, type Q } from "./db.ts";
import { addDays, computeDurations, isValidTimeZone, localDate, streaks, type Beat } from "./time.ts";
import type { ParsedHeartbeat } from "./heartbeat.ts";
import { costMicros, priceFor, type ParsedUsage } from "./usage.ts";

const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Write path ---------------------------------------------------------------

const INSERT_COLS = 10;

/**
 * Store a batch and rebuild the rollups of every day it touched. Duplicates
 * (client retries) hit the UNIQUE constraint and are ignored, so sending the
 * same batch twice is harmless. Statements are batched (one multi-row INSERT,
 * one upsert per project) because each one is a network round trip on Turso.
 */
export async function ingest(userId: number, tz: string, beats: ParsedHeartbeat[]) {
  if (beats.length === 0) return { accepted: 0, duplicates: 0 };
  return tx(async (q) => {
    const params: Param[] = [];
    for (const b of beats) {
      params.push(userId, b.time, localDate(b.time, tz), b.project, b.language, b.branch, b.editor, b.category, b.is_write ? 1 : 0, b.entity);
    }
    const placeholders = beats.map(() => `(${new Array(INSERT_COLS).fill("?").join(", ")})`).join(", ");
    // RETURNING lists only the rows that were actually new.
    const inserted = await q.all<{ local_date: string }>(
      `INSERT OR IGNORE INTO heartbeats
         (user_id, time, local_date, project, language, branch, editor, category, is_write, entity)
       VALUES ${placeholders} RETURNING local_date`,
      ...params,
    );

    const projects = new Map<string, { first: number; last: number; stack: string[] }>();
    for (const b of beats) {
      const p = projects.get(b.project) ?? { first: b.time, last: b.time, stack: [] };
      p.first = Math.min(p.first, b.time);
      p.last = Math.max(p.last, b.time);
      if (b.stack.length) p.stack = b.stack;
      projects.set(b.project, p);
    }
    for (const [name, p] of projects) {
      await q.run(
        `INSERT INTO projects (user_id, name, stack, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET
           stack = CASE WHEN excluded.stack <> '[]' THEN excluded.stack ELSE projects.stack END,
           first_seen = MIN(projects.first_seen, excluded.first_seen),
           last_seen = MAX(projects.last_seen, excluded.last_seen)`,
        userId, name, JSON.stringify(p.stack), p.first, p.last,
      );
    }

    const dates = new Set(inserted.map((r) => r.local_date));
    for (const d of dates) await recomputeDay(q, userId, d, tz);
    return { accepted: inserted.length, duplicates: beats.length - inserted.length };
  });
}

export async function recomputeDay(q: Q, userId: number, date: string, tz: string) {
  const beats = await q.all<Beat>(
    // Only heartbeats from writing code count (typing, saving, an agent editing a file).
    // Older collectors also sent file switches and agent prompts; those are stored but ignored.
    "SELECT time, project, language, editor, category FROM heartbeats WHERE user_id = ? AND local_date = ? AND is_write = 1 ORDER BY time",
    userId, date,
  );
  const d = computeDurations(beats, undefined, tz);

  await q.run("DELETE FROM daily_stats WHERE user_id = ? AND date = ?", userId, date);
  await q.run("DELETE FROM daily_breakdown WHERE user_id = ? AND date = ?", userId, date);
  await q.run("DELETE FROM daily_hours WHERE user_id = ? AND date = ?", userId, date);
  if (d.total === 0) return;

  await q.run("INSERT INTO daily_stats (user_id, date, seconds, ai_seconds) VALUES (?, ?, ?, ?)", userId, date, d.total, d.ai);
  const rows: Param[] = [];
  for (const [kind, map, ai] of [
    ["project", d.project, d.aiProject],
    ["language", d.language, d.aiLanguage],
    ["editor", d.editor, d.aiEditor],
  ] as const) {
    for (const [name, sec] of map) rows.push(userId, date, kind, name, sec, ai.get(name) ?? 0);
  }
  if (rows.length) {
    await q.run(
      `INSERT INTO daily_breakdown (user_id, date, kind, name, seconds, ai_seconds) VALUES ${new Array(rows.length / 6).fill("(?, ?, ?, ?, ?, ?)").join(", ")}`,
      ...rows,
    );
  }
  const hours: Param[] = [];
  for (const [h, sec] of d.hour) hours.push(userId, date, h, sec);
  if (hours.length) {
    await q.run(`INSERT INTO daily_hours (user_id, date, hour, seconds) VALUES ${new Array(hours.length / 4).fill("(?, ?, ?, ?)").join(", ")}`, ...hours);
  }
}

/**
 * Store token-usage records and rebuild the AI rollups of every day they touched.
 * Records are dated in the user's time zone, like heartbeats. Retries are ignored.
 */
export async function ingestUsage(userId: number, tz: string, records: ParsedUsage[]) {
  if (records.length === 0) return { accepted: 0, duplicates: 0 };
  return tx(async (q) => {
    const params: Param[] = [];
    for (const r of records) {
      params.push(userId, r.id, r.time, localDate(r.time, tz), r.agent, r.model, r.input, r.output, r.cache_read, r.cache_write);
    }
    const inserted = await q.all<{ local_date: string }>(
      `INSERT OR IGNORE INTO ai_usage (user_id, id, time, local_date, agent, model, input, output, cache_read, cache_write)
       VALUES ${records.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")} RETURNING local_date`,
      ...params,
    );
    for (const d of new Set(inserted.map((r) => r.local_date))) await recomputeAiDay(q, userId, d);
    return { accepted: inserted.length, duplicates: records.length - inserted.length };
  });
}

export async function recomputeAiDay(q: Q, userId: number, date: string) {
  const rows = await q.all<{ agent: string; model: string; input: number; output: number; cache_read: number; cache_write: number }>(
    `SELECT agent, model, SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
       FROM ai_usage WHERE user_id = ? AND local_date = ? GROUP BY agent, model`,
    userId, date,
  );
  await q.run("DELETE FROM daily_ai_usage WHERE user_id = ? AND date = ?", userId, date);
  if (!rows.length) return;
  const params: Param[] = [];
  for (const r of rows) params.push(userId, date, r.agent, r.model, r.input, r.output, r.cache_read, r.cache_write, costMicros(r.model, r));
  await q.run(
    `INSERT INTO daily_ai_usage (user_id, date, agent, model, input, output, cache_read, cache_write, cost_micros)
     VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
    ...params,
  );
}

// ---- Read path ----------------------------------------------------------------

export interface DayCell { date: string; seconds: number; ai_seconds: number }

export function todayFor(tz: string) {
  return localDate(nowSec(), tz);
}

export function dailySeries(userId: number, from: string, to: string): Promise<DayCell[]> {
  return all<DayCell>("SELECT date, seconds, ai_seconds FROM daily_stats WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date", userId, from, to);
}

export function breakdown(userId: number, kind: "project" | "language" | "editor", from: string, to: string, limit = 8) {
  return all<{ name: string; seconds: number }>(
    `SELECT name, SUM(seconds) AS seconds FROM daily_breakdown
      WHERE user_id = ? AND kind = ? AND date BETWEEN ? AND ?
      GROUP BY name ORDER BY seconds DESC LIMIT ?`,
    userId, kind, from, to, limit,
  );
}

export interface ProjectRow { name: string; stack: string[]; seconds: number; last_seen: number }

export async function projectList(userId: number, from: string, to: string, limit = 8): Promise<ProjectRow[]> {
  const rows = await all<(Omit<ProjectRow, "stack"> & { stack: string })>(`SELECT p.name, p.stack, p.last_seen, COALESCE(SUM(b.seconds), 0) AS seconds
       FROM projects p
       LEFT JOIN daily_breakdown b
         ON b.user_id = p.user_id AND b.kind = 'project' AND b.name = p.name AND b.date BETWEEN ? AND ?
      WHERE p.user_id = ?
      GROUP BY p.name HAVING seconds > 0
      ORDER BY seconds DESC LIMIT ?`, from, to, userId, limit);
  return rows.map((r) => ({ ...r, stack: safeJsonArray(r.stack) }));
}

/** Union of detected stack entries across the user's recent projects, most common first. */
export async function techStack(userId: number, sinceSec: number, limit = 14): Promise<string[]> {
  const rows = await all<{ stack: string }>("SELECT stack FROM projects WHERE user_id = ? AND last_seen >= ?", userId, sinceSec);
  const counts = new Map<string, number>();
  for (const r of rows) for (const s of safeJsonArray(r.stack)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([s]) => s);
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export interface Summary {
  today: number;
  week: number;
  month: number;
  year: number;
  aiYear: number;
  dailyAvg: number;
  activeDays: number;
  best: DayCell | null;
  streak: { current: number; longest: number };
}

export async function summary(userId: number, tz: string): Promise<Summary> {
  const today = todayFor(tz);
  const yearFrom = addDays(today, -364);
  const days = await dailySeries(userId, yearFrom, today);
  const sumFrom = (from: string) => days.filter((d) => d.date >= from).reduce((a, d) => a + d.seconds, 0);
  const year = sumFrom(yearFrom);
  const last30Active = days.filter((d) => d.date >= addDays(today, -29));
  return {
    today: days.find((d) => d.date === today)?.seconds ?? 0,
    week: sumFrom(addDays(today, -6)),
    month: sumFrom(addDays(today, -29)),
    year,
    aiYear: days.reduce((a, d) => a + d.ai_seconds, 0),
    dailyAvg: last30Active.length ? Math.round(last30Active.reduce((a, d) => a + d.seconds, 0) / last30Active.length) : 0,
    activeDays: days.length,
    best: days.reduce<DayCell | null>((m, d) => (!m || d.seconds > m.seconds ? d : m), null),
    streak: streaks(days.map((d) => d.date), today),
  };
}

// ---- Leaderboard -------------------------------------------------------------

export interface LeaderRow {
  rank: number;
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  quote: string;
  bio: string;
  twitter: string;
  github: string;
  location: string;
  seconds: number;
  ai_seconds: number;
  daily_avg: number;
  top_language: string | null;
  /** Every language they used in the period, most time first. */
  languages: { name: string; seconds: number }[];
  /** Frameworks and tools detected in the projects they worked on in the period, most common first. */
  stack: string[];
}

/** Detected tech stack per user, from the projects they touched since `sinceSec`. One query for all rows. */
async function stacksFor(userIds: number[], sinceSec: number, limit = 6): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!userIds.length) return out;
  const rows = await all<{ user_id: number; stack: string }>(
    `SELECT user_id, stack FROM projects WHERE last_seen >= ? AND user_id IN (${userIds.map(() => "?").join(",")})`,
    sinceSec, ...userIds,
  );
  const counts = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const c = counts.get(r.user_id) ?? new Map<string, number>();
    for (const s of safeJsonArray(r.stack)) c.set(s, (c.get(s) ?? 0) + 1);
    counts.set(r.user_id, c);
  }
  for (const [id, c] of counts) out.set(id, [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([s]) => s));
  return out;
}

/**
 * AI-agent time a user can score per day on the "all" boards. An agent left
 * running keeps writing files and would otherwise climb the board unattended.
 * Personal stats are never capped; only rankings are.
 */
export const AI_DAILY_CAP_SEC = 4 * 3600;

/** "all": hands-on time plus capped AI time. "hands-on": AI-agent time excluded. */
export type BoardMode = "all" | "hands-on";

/**
 * What the Coding board ranks: time spent writing code, by hand or by an AI
 * agent editing files, with agent time capped at AI_DAILY_CAP_SEC a day so an
 * agent left running can't top the board. The Agents board ranks the same
 * people by tokens instead, so everyone who codes with an agent shows on both.
 */
export const CODING_MODE: BoardMode = "all";

export interface BoardOptions {
  /** Shift the window back this many days (e.g. `days` for the previous period). */
  offsetDays?: number;
  /** Rank by time in one language instead of total time. */
  language?: string;
  mode?: BoardMode;
  /** Skip the per-user language lists (only positions are needed). */
  ranksOnly?: boolean;
}

/**
 * Ranked seconds for one rollup row (`t` = daily_stats or daily_breakdown alias):
 * hands-on time, plus AI time up to the daily cap unless the board is hands-on.
 */
function scoredSeconds(t: string, mode: BoardMode) {
  return mode === "hands-on"
    ? `(${t}.seconds - ${t}.ai_seconds)`
    : `(${t}.seconds - ${t}.ai_seconds + MIN(${t}.ai_seconds, ${AI_DAILY_CAP_SEC}))`;
}

/**
 * Each user's own last `days` local calendar days, as a VALUES table keyed by
 * time zone: everyone's week ends at their own midnight, not at UTC midnight.
 * One row per distinct time zone, so this stays small however many users exist.
 */
let zoneCache: { at: number; zones: { timezone: string }[] } | undefined;

/** Call after a user is created or changes time zone, so boards include them at once. */
export function forgetTimeZones() {
  zoneCache = undefined;
}

async function localWindows(days: number, offsetDays: number) {
  const now = nowSec();
  // A page builds two or three boards; the zone list changes only when someone
  // picks a new zone in Settings, so a minute's staleness is fine.
  if (!zoneCache || now - zoneCache.at >= 60) zoneCache = { at: now, zones: await all<{ timezone: string }>("SELECT DISTINCT timezone FROM users") };
  const zones = zoneCache.zones;
  const params: Param[] = [];
  for (const { timezone } of zones) {
    const to = addDays(localDate(now, isValidTimeZone(timezone) ? timezone : "UTC"), -offsetDays);
    params.push(timezone, addDays(to, -(days - 1)), to);
  }
  return { sql: `win(tz, d_from, d_to) AS (VALUES ${zones.map(() => "(?, ?, ?)").join(", ")})`, params, empty: zones.length === 0 };
}

/** Ranks everyone by tracked time over their own last `days` local days. */
export async function leaderboard(days: number, limit = 100, opts: BoardOptions = {}): Promise<LeaderRow[]> {
  const mode = opts.mode ?? "all";
  const offset = opts.offsetDays ?? 0;
  const win = await localWindows(days, offset);
  if (win.empty) return [];
  const cols = `u.id AS user_id, u.username, u.display_name, u.avatar_url, u.quote, u.bio, u.twitter, u.github, u.location`;
  const from = `JOIN users u ON u.id = t.user_id JOIN win w ON w.tz = u.timezone`;
  const inWindow = `t.date BETWEEN w.d_from AND w.d_to`;
  // Per-user lookups write `+kind` so SQLite uses the (user_id, date, ...) primary key,
  // not daily_breakdown_kind_date, which would read every user's rows once per user.
  const topLang = `(SELECT b2.name FROM daily_breakdown b2
              WHERE b2.user_id = u.id AND +b2.kind = 'language' AND b2.date BETWEEN w.d_from AND w.d_to
              GROUP BY b2.name ORDER BY SUM(${scoredSeconds("b2", mode)}) DESC LIMIT 1) AS top_language`;
  const aiCol = mode === "hands-on" ? "0" : `SUM(MIN(t.ai_seconds, ${AI_DAILY_CAP_SEC}))`;
  const rows = opts.language
    ? await all<Omit<LeaderRow, "rank" | "daily_avg" | "languages">>(
        `WITH ${win.sql}
         SELECT ${cols}, SUM(${scoredSeconds("t", mode)}) AS seconds, ${aiCol} AS ai_seconds, ${topLang}
           FROM daily_breakdown t ${from}
          WHERE t.kind = 'language' AND t.name = ? AND ${inWindow}
          GROUP BY u.id
          HAVING SUM(${scoredSeconds("t", mode)}) > 0
          ORDER BY seconds DESC, u.username ASC
          LIMIT ?`,
        ...win.params, opts.language, limit,
      )
    : await all<Omit<LeaderRow, "rank" | "daily_avg" | "languages">>(
        `WITH ${win.sql}
         SELECT ${cols}, SUM(${scoredSeconds("t", mode)}) AS seconds, ${aiCol} AS ai_seconds, ${topLang}
           FROM daily_stats t ${from}
          WHERE ${inWindow}
          GROUP BY u.id
          HAVING SUM(${scoredSeconds("t", mode)}) > 0
          ORDER BY seconds DESC, u.username ASC
          LIMIT ?`,
        ...win.params, limit,
      );
  // One grouped query for everyone's languages instead of one query per row.
  const langs = new Map<number, { name: string; seconds: number }[]>();
  let stacks = new Map<number, string[]>();
  if (rows.length && !opts.ranksOnly) {
    const ids = rows.map((r) => r.user_id);
    const [stackRows, langRows] = await Promise.all([
      stacksFor(ids, nowSec() - (days + offset + 1) * 86400),
      all<{ user_id: number; name: string; seconds: number }>(
        `WITH ${win.sql}
         SELECT t.user_id, t.name, SUM(${scoredSeconds("t", mode)}) AS seconds
           FROM daily_breakdown t ${from}
          WHERE +t.kind = 'language' AND ${inWindow} AND t.user_id IN (${ids.map(() => "?").join(",")})
          GROUP BY t.user_id, t.name HAVING SUM(${scoredSeconds("t", mode)}) > 0 ORDER BY t.user_id, seconds DESC`,
        ...win.params, ...ids,
      ),
    ]);
    stacks = stackRows;
    for (const l of langRows) {
      const list = langs.get(l.user_id) ?? [];
      list.push({ name: l.name, seconds: l.seconds });
      langs.set(l.user_id, list);
    }
  }
  return rows.map((r, i) => ({ ...r, rank: i + 1, daily_avg: Math.round(r.seconds / days), languages: langs.get(r.user_id) ?? [], stack: stacks.get(r.user_id) ?? [] }));
}

export async function rankOf(userId: number, days = 7, mode: BoardMode = CODING_MODE): Promise<{ rank: number; of: number } | null> {
  const board = await leaderboard(days, 10_000, { ranksOnly: true, mode });
  const idx = board.findIndex((r) => r.user_id === userId);
  return idx === -1 ? null : { rank: idx + 1, of: board.length };
}

// ---- Community view (the landing page shows a fixed sample in this shape) -------

export interface CommunityWeek {
  seconds: number;
  aiSeconds: number;
  devs: number;
  projects: number;
  languages: { name: string; seconds: number }[];
  editors: { name: string; seconds: number }[];
  stacks: { name: string; projects: number }[];
  /** Tracked seconds per local hour of day (0-23), each in its owner's time zone. */
  hours: number[];
}

/** Languages with the most tracked time in the window, for the leaderboard filter. */
export function boardLanguages(days: number, limit = 10) {
  const today = localDate(nowSec(), "UTC");
  return all<{ name: string; seconds: number }>(
    `SELECT name, SUM(seconds) AS seconds FROM daily_breakdown
      WHERE kind = 'language' AND date BETWEEN ? AND ? AND name <> 'Other'
      GROUP BY name ORDER BY seconds DESC LIMIT ?`,
    addDays(today, -(days - 1)), addDays(today, 1), limit,
  );
}

/** Rank each user held in the previous window, for ▲/▼ movement. */
export async function previousRanks(days: number, opts: Omit<BoardOptions, "offsetDays"> = {}) {
  const prev = await leaderboard(days, 10_000, { ...opts, offsetDays: days, ranksOnly: true });
  return new Map(prev.map((r) => [r.user_id, r.rank]));
}

// ---- Personal insights ----------------------------------------------------------

export interface Insights {
  thisWeek: number;
  lastWeek: number;
  /** Weekday (0 = Sunday) with the highest average over the last 12 weeks, or null. */
  bestWeekday: { day: number; avg: number } | null;
  /** Local hour with the most tracked time in the last 30 days, or null. */
  peakHour: { hour: number; share: number } | null;
}

export async function insights(userId: number, tz: string): Promise<Insights> {
  const today = todayFor(tz);
  const [days, hours] = await Promise.all([
    dailySeries(userId, addDays(today, -83), today),
    all<{ hour: number; seconds: number }>(
      "SELECT hour, SUM(seconds) AS seconds FROM daily_hours WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY hour",
      userId, addDays(today, -29), today,
    ),
  ]);
  const sum = (from: string, to: string) => days.filter((d) => d.date >= from && d.date <= to).reduce((a, d) => a + d.seconds, 0);

  // Average per weekday over all 12 weeks (days without activity count as zero).
  const totals = new Array<number>(7).fill(0);
  for (const d of days) totals[new Date(`${d.date}T00:00:00Z`).getUTCDay()] += d.seconds;
  const best = totals.reduce((b, v, i) => (v > totals[b] ? i : b), 0);

  const hourTotal = hours.reduce((a, h) => a + h.seconds, 0);
  const peak = hours.reduce<{ hour: number; seconds: number } | null>((m, h) => (!m || h.seconds > m.seconds ? h : m), null);

  return {
    thisWeek: sum(addDays(today, -6), today),
    lastWeek: sum(addDays(today, -13), addDays(today, -7)),
    bestWeekday: totals[best] > 0 ? { day: best, avg: Math.round(totals[best] / 12) } : null,
    peakHour: peak && hourTotal ? { hour: peak.hour, share: peak.seconds / hourTotal } : null,
  };
}

// ---- AI usage ----------------------------------------------------------------------

export type AiSort = "tokens" | "cost" | "time";

export interface AiLeaderRow {
  rank: number;
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  quote: string;
  bio: string;
  twitter: string;
  github: string;
  location: string;
  /** Input + output + cache reads + cache writes. */
  tokens: number;
  output: number;
  cost_micros: number;
  /** Time AI agents spent writing files (uncapped: this board is about agents). */
  ai_seconds: number;
  /** Models by tokens, most first. */
  models: { name: string; tokens: number; cost_micros: number }[];
  /** Agents that reported usage or time, most tokens first. */
  agents: string[];
  /** The agent behind this person's most recent token usage, or null. */
  current_agent: string | null;
}

const AI_ORDER: Record<AiSort, string> = {
  tokens: "tokens DESC, cost_micros DESC",
  cost: "cost_micros DESC, tokens DESC",
  time: "ai_seconds DESC, tokens DESC",
};

/**
 * Ranks everyone by AI-agent usage over their own last `days` local calendar
 * days (the same windows as the coding board, so both reset at each person's
 * midnight). Agent time with no token data (Cursor's agent, older hooks) still
 * puts someone on the board.
 */
export async function aiLeaderboard(
  days: number,
  limit = 100,
  opts: { offsetDays?: number; sort?: AiSort; ranksOnly?: boolean } = {},
): Promise<AiLeaderRow[]> {
  const sort = opts.sort ?? "tokens";
  const win = await localWindows(days, opts.offsetDays ?? 0);
  if (win.empty) return [];
  const from = `JOIN users u ON u.id = t.user_id JOIN win w ON w.tz = u.timezone`;
  const inWindow = `t.date BETWEEN w.d_from AND w.d_to`;
  const rows = await all<Omit<AiLeaderRow, "rank" | "models" | "agents" | "current_agent">>(
    `WITH ${win.sql},
     x AS (
       SELECT t.user_id, t.input + t.output + t.cache_read + t.cache_write AS tokens, t.output, t.cost_micros, 0 AS ai_seconds
         FROM daily_ai_usage t ${from} WHERE ${inWindow}
       UNION ALL
       SELECT t.user_id, 0, 0, 0, t.ai_seconds FROM daily_stats t ${from} WHERE ${inWindow} AND t.ai_seconds > 0
     )
     SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, u.quote, u.bio, u.twitter, u.github, u.location,
            SUM(x.tokens) AS tokens, SUM(x.output) AS output, SUM(x.cost_micros) AS cost_micros, SUM(x.ai_seconds) AS ai_seconds
       FROM x JOIN users u ON u.id = x.user_id
      GROUP BY u.id
      HAVING ${sort === "time" ? "SUM(x.ai_seconds) > 0" : "SUM(x.tokens) > 0"}
      ORDER BY ${AI_ORDER[sort]}, u.username ASC
      LIMIT ?`,
    ...win.params, limit,
  );
  const models = new Map<number, AiLeaderRow["models"]>();
  const agents = new Map<number, string[]>();
  const current = new Map<number, string>();
  if (rows.length && !opts.ranksOnly) {
    const ids = rows.map((r) => r.user_id);
    const [modelRows, agentRows, latest] = await Promise.all([
      all<{ user_id: number; name: string; tokens: number; cost_micros: number }>(
        `WITH ${win.sql}
         SELECT t.user_id, t.model AS name, SUM(t.input + t.output + t.cache_read + t.cache_write) AS tokens, SUM(t.cost_micros) AS cost_micros
           FROM daily_ai_usage t ${from}
          WHERE ${inWindow} AND t.user_id IN (${ids.map(() => "?").join(",")})
          GROUP BY t.user_id, t.model ORDER BY t.user_id, tokens DESC`,
        ...win.params, ...ids,
      ),
      // Agents: from usage records, and from agent time for agents that send no token data.
      all<{ user_id: number; name: string; tokens: number }>(
        `WITH ${win.sql}
         SELECT user_id, name, SUM(tokens) AS tokens FROM (
           SELECT t.user_id, t.agent AS name, t.input + t.output + t.cache_read + t.cache_write AS tokens
             FROM daily_ai_usage t ${from} WHERE ${inWindow} AND t.user_id IN (${ids.map(() => "?").join(",")})
           UNION ALL
           SELECT t.user_id, t.name, 0 FROM daily_breakdown t ${from}
            WHERE +t.kind = 'editor' AND t.ai_seconds > 0 AND ${inWindow} AND t.user_id IN (${ids.map(() => "?").join(",")})
         ) GROUP BY user_id, name ORDER BY user_id, tokens DESC`,
        ...win.params, ...ids, ...ids,
      ),
      // Latest record per person (any day): the agent they are using now.
      all<{ user_id: number; agent: string }>(
        `SELECT a.user_id, a.agent FROM ai_usage a
          WHERE a.user_id IN (${ids.map(() => "?").join(",")})
            AND a.time = (SELECT MAX(b.time) FROM ai_usage b WHERE b.user_id = a.user_id)
          ORDER BY a.rowid`, // on a tie, the last one stored wins (Map.set below)
        ...ids,
      ),
    ]);
    for (const l of latest) current.set(l.user_id, l.agent);
    for (const m of modelRows) models.set(m.user_id, [...(models.get(m.user_id) ?? []), { name: m.name, tokens: m.tokens, cost_micros: m.cost_micros }]);
    for (const a of agentRows) agents.set(a.user_id, [...(agents.get(a.user_id) ?? []), a.name]);
  }
  return rows.map((r, i) => ({
    ...r, rank: i + 1, models: models.get(r.user_id) ?? [], agents: agents.get(r.user_id) ?? [], current_agent: current.get(r.user_id) ?? null,
  }));
}

/** Rank each user held on the AI board in the previous window, for ▲/▼ movement. */
export async function previousAiRanks(days: number, sort: AiSort = "tokens") {
  const prev = await aiLeaderboard(days, 10_000, { offsetDays: days, sort, ranksOnly: true });
  return new Map(prev.map((r) => [r.user_id, r.rank]));
}

export interface AiTotals {
  tokens: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost_micros: number;
}

export interface AiSummary {
  /** The requested range. */
  range: AiTotals & {
    models: (AiTotals & { name: string; priced: boolean })[];
    agents: { name: string; tokens: number; cost_micros: number }[];
  };
  today: AiTotals;
  /** Everything ever recorded. */
  allTime: AiTotals;
  /** First day with token data, or null when there is none. */
  since: string | null;
}

const TOTALS = `SUM(input + output + cache_read + cache_write) AS tokens, SUM(input) AS input, SUM(output) AS output,
  SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write, SUM(cost_micros) AS cost_micros`;
const ZERO: AiTotals = { tokens: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost_micros: 0 };
const orZero = (t: Partial<Record<keyof AiTotals, number | null>> | null): AiTotals =>
  Object.fromEntries(Object.keys(ZERO).map((k) => [k, Number(t?.[k as keyof AiTotals] ?? 0)])) as unknown as AiTotals;

/** One person's AI tokens and estimated spend: `from`..`to` (local dates), today and all time. */
export async function aiSummary(userId: number, tz: string, from: string, to: string): Promise<AiSummary> {
  const today = todayFor(tz);
  const [models, agents, todayRow, allRow] = await Promise.all([
    all<AiTotals & { name: string }>(
      `SELECT model AS name, ${TOTALS} FROM daily_ai_usage WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY model ORDER BY tokens DESC`,
      userId, from, to,
    ),
    all<{ name: string; tokens: number; cost_micros: number }>(
      `SELECT agent AS name, SUM(input + output + cache_read + cache_write) AS tokens, SUM(cost_micros) AS cost_micros
         FROM daily_ai_usage WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY agent ORDER BY tokens DESC`,
      userId, from, to,
    ),
    get<AiTotals>(`SELECT ${TOTALS} FROM daily_ai_usage WHERE user_id = ? AND date = ?`, userId, today),
    get<AiTotals & { since: string | null }>(`SELECT ${TOTALS}, MIN(date) AS since FROM daily_ai_usage WHERE user_id = ?`, userId),
  ]);
  const range = orZero(null);
  const modelTotals = models.map((m) => {
    const t = orZero(m);
    for (const k of Object.keys(ZERO) as (keyof AiTotals)[]) range[k] += t[k];
    return { ...t, name: m.name, priced: priceFor(m.name) !== undefined };
  });
  return { range: { ...range, models: modelTotals, agents }, today: orZero(todayRow), allTime: orZero(allRow), since: allRow?.since ?? null };
}
