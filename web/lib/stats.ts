import { all, get, tx, type Param, type Q } from "./db.ts";
import { addDays, computeDurations, localDate, streaks, type Beat } from "./time.ts";
import type { ParsedHeartbeat } from "./heartbeat.ts";

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
  for (const [kind, map] of [["project", d.project], ["language", d.language], ["editor", d.editor]] as const) {
    for (const [name, sec] of map) rows.push(userId, date, kind, name, sec);
  }
  if (rows.length) {
    await q.run(`INSERT INTO daily_breakdown (user_id, date, kind, name, seconds) VALUES ${new Array(rows.length / 5).fill("(?, ?, ?, ?, ?)").join(", ")}`, ...rows);
  }
  const hours: Param[] = [];
  for (const [h, sec] of d.hour) hours.push(userId, date, h, sec);
  if (hours.length) {
    await q.run(`INSERT INTO daily_hours (user_id, date, hour, seconds) VALUES ${new Array(hours.length / 4).fill("(?, ?, ?, ?)").join(", ")}`, ...hours);
  }
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
}

/**
 * Ranks everyone by tracked time over the last `days` days. The cutoff uses the
 * UTC calendar; per-user dates are local, so the edges can differ by a few hours
 * across time zones, which is an accepted approximation for a weekly board.
 */
export interface BoardOptions {
  /** Shift the window back this many days (e.g. `days` for the previous period). */
  offsetDays?: number;
  /** Rank by time in one language instead of total time. */
  language?: string;
  /** Skip the per-user language lists (only positions are needed). */
  ranksOnly?: boolean;
}

export async function leaderboard(days: number, limit = 100, opts: BoardOptions = {}): Promise<LeaderRow[]> {
  const today = localDate(nowSec(), "UTC");
  const offset = opts.offsetDays ?? 0;
  const anchor = addDays(today, -offset);
  const from = addDays(anchor, -(days - 1));
  // The current window reaches one day ahead to cover time zones east of UTC.
  const end = offset ? anchor : addDays(anchor, 1);
  const cols = `u.id AS user_id, u.username, u.display_name, u.avatar_url, u.quote, u.bio, u.twitter, u.github, u.location`;
  const topLang = `(SELECT b2.name FROM daily_breakdown b2
              WHERE b2.user_id = u.id AND b2.kind = 'language' AND b2.date BETWEEN ? AND ?
              GROUP BY b2.name ORDER BY SUM(b2.seconds) DESC LIMIT 1) AS top_language`;
  const rows = opts.language
    ? await all<Omit<LeaderRow, "rank" | "daily_avg" | "languages">>(
        `SELECT ${cols}, SUM(b.seconds) AS seconds, 0 AS ai_seconds, ${topLang}
           FROM daily_breakdown b JOIN users u ON u.id = b.user_id
          WHERE b.kind = 'language' AND b.name = ? AND b.date BETWEEN ? AND ?
          GROUP BY u.id
          HAVING seconds > 0
          ORDER BY seconds DESC, u.username ASC
          LIMIT ?`,
        from, end, opts.language, from, end, limit,
      )
    : await all<Omit<LeaderRow, "rank" | "daily_avg" | "languages">>(
        `SELECT ${cols}, SUM(s.seconds) AS seconds, SUM(s.ai_seconds) AS ai_seconds, ${topLang}
           FROM daily_stats s JOIN users u ON u.id = s.user_id
          WHERE s.date BETWEEN ? AND ?
          GROUP BY u.id
          HAVING seconds > 0
          ORDER BY seconds DESC, u.username ASC
          LIMIT ?`,
        from, end, from, end, limit,
      );
  // One grouped query for everyone's languages instead of one query per row.
  const langs = new Map<number, { name: string; seconds: number }[]>();
  if (rows.length && !opts.ranksOnly) {
    const ids = rows.map((r) => r.user_id);
    for (const l of await all<{ user_id: number; name: string; seconds: number }>(
      `SELECT user_id, name, SUM(seconds) AS seconds FROM daily_breakdown
        WHERE kind = 'language' AND date BETWEEN ? AND ? AND user_id IN (${ids.map(() => "?").join(",")})
        GROUP BY user_id, name ORDER BY user_id, seconds DESC`,
      from, end, ...ids,
    )) {
      const list = langs.get(l.user_id) ?? [];
      list.push({ name: l.name, seconds: l.seconds });
      langs.set(l.user_id, list);
    }
  }
  return rows.map((r, i) => ({ ...r, rank: i + 1, daily_avg: Math.round(r.seconds / days), languages: langs.get(r.user_id) ?? [] }));
}

export async function rankOf(userId: number, days = 7): Promise<{ rank: number; of: number } | null> {
  const board = await leaderboard(days, 10_000);
  const idx = board.findIndex((r) => r.user_id === userId);
  return idx === -1 ? null : { rank: idx + 1, of: board.length };
}

let totalsCache: { at: number; value: { devs: number; seconds: number } } | null = null;

export async function siteTotals() {
  const now = nowSec();
  if (totalsCache && now - totalsCache.at < 60) return totalsCache.value;
  const value = (await get<{ devs: number; seconds: number }>(
    "SELECT COUNT(DISTINCT user_id) AS devs, COALESCE(SUM(seconds), 0) AS seconds FROM daily_stats",
  ))!;
  totalsCache = { at: now, value };
  return value;
}

// ---- Community (everyone, last 7 days) ---------------------------------------

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

let communityCache: { at: number; value: CommunityWeek } | null = null;

export async function communityWeek(): Promise<CommunityWeek> {
  const now = nowSec();
  if (communityCache && now - communityCache.at < 60) return communityCache.value;

  const today = localDate(now, "UTC");
  const from = addDays(today, -6);
  const end = addDays(today, 1);
  const kind = (k: "language" | "editor", limit: number) =>
    all<{ name: string; seconds: number }>(
      "SELECT name, SUM(seconds) AS seconds FROM daily_breakdown WHERE kind = ? AND date BETWEEN ? AND ? GROUP BY name ORDER BY seconds DESC LIMIT ?",
      k, from, end, limit,
    );
  const [totals, languages, editors, projectRows, hourRows] = await Promise.all([
    get<{ seconds: number; ai: number; devs: number }>(
      "SELECT COALESCE(SUM(seconds), 0) AS seconds, COALESCE(SUM(ai_seconds), 0) AS ai, COUNT(DISTINCT user_id) AS devs FROM daily_stats WHERE date BETWEEN ? AND ?",
      from, end,
    ),
    kind("language", 6),
    kind("editor", 6),
    all<{ stack: string }>("SELECT stack FROM projects WHERE last_seen >= ?", now - 7 * 86400),
    all<{ hour: number; seconds: number }>(
      "SELECT hour, SUM(seconds) AS seconds FROM daily_hours WHERE date BETWEEN ? AND ? GROUP BY hour", from, end,
    ),
  ]);

  const stackCounts = new Map<string, number>();
  for (const r of projectRows) for (const s of safeJsonArray(r.stack)) stackCounts.set(s, (stackCounts.get(s) ?? 0) + 1);
  const hours = new Array<number>(24).fill(0);
  for (const r of hourRows) hours[r.hour] = r.seconds;

  const value: CommunityWeek = {
    seconds: totals!.seconds,
    aiSeconds: totals!.ai,
    devs: totals!.devs,
    projects: projectRows.length,
    languages,
    editors,
    stacks: [...stackCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, projects]) => ({ name, projects })),
    hours,
  };
  communityCache = { at: now, value };
  return value;
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

// ---- Rolling 24-hour leaderboard ---------------------------------------------------

const board24Cache = new Map<string, { at: number; rows: LeaderRow[] }>();

/**
 * Ranks the last 24 hours (not a calendar day) straight from heartbeats, using
 * the same merged-timeline rule as the daily rollups. `offsetHours` shifts the
 * window back, e.g. 24 for the previous day's ranks. Cached for a minute.
 */
export async function leaderboard24h(limit = 100, opts: { offsetHours?: number; language?: string } = {}): Promise<LeaderRow[]> {
  const key = `${opts.offsetHours ?? 0}|${opts.language ?? ""}`;
  const cached = board24Cache.get(key);
  const now = nowSec();
  if (cached && now - cached.at < 60) return cached.rows.slice(0, limit);

  const end = now - (opts.offsetHours ?? 0) * 3600;
  const beats = await all<Beat & { user_id: number }>(
    "SELECT user_id, time, project, language, editor, category FROM heartbeats WHERE time >= ? AND time < ? AND is_write = 1 ORDER BY user_id, time",
    end - 86400, end,
  );
  const byUser = new Map<number, Beat[]>();
  for (const b of beats) {
    const list = byUser.get(b.user_id) ?? [];
    list.push(b);
    byUser.set(b.user_id, list);
  }
  const scored = [...byUser.entries()]
    .map(([user_id, list]) => {
      const d = computeDurations(list);
      const languages = [...d.language.entries()].sort((a, b) => b[1] - a[1]).map(([name, seconds]) => ({ name, seconds }));
      const seconds = opts.language ? d.language.get(opts.language) ?? 0 : d.total;
      return { user_id, seconds, ai_seconds: opts.language ? 0 : d.ai, languages };
    })
    .filter((r) => r.seconds > 0);

  const users = scored.length
    ? await all<{ user_id: number; username: string; display_name: string; avatar_url: string; quote: string; bio: string; twitter: string; github: string; location: string }>(
        `SELECT id AS user_id, username, display_name, avatar_url, quote, bio, twitter, github, location FROM users WHERE id IN (${scored.map(() => "?").join(",")})`,
        ...scored.map((r) => r.user_id),
      )
    : [];
  const info = new Map(users.map((u) => [u.user_id, u]));
  const rows: LeaderRow[] = scored
    .filter((r) => info.has(r.user_id))
    .sort((a, b) => b.seconds - a.seconds || info.get(a.user_id)!.username.localeCompare(info.get(b.user_id)!.username))
    .map((r, i) => ({ ...info.get(r.user_id)!, ...r, rank: i + 1, daily_avg: r.seconds, top_language: r.languages[0]?.name ?? null }));
  board24Cache.set(key, { at: now, rows });
  return rows.slice(0, limit);
}
