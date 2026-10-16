// Pure time helpers. No database access here so they are easy to unit test.

/** Gaps longer than this between two heartbeats are treated as a break. */
export const IDLE_TIMEOUT_SEC = 15 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of a unix timestamp (seconds) in the given IANA time zone. */
export function localDate(unixSec: number, tz: string): string {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(tz, f);
  }
  return f.format(new Date(unixSec * 1000));
}

export interface Beat {
  time: number;
  project: string;
  language: string;
  editor: string;
  category: "coding" | "ai";
}

export interface DayDurations {
  total: number;
  ai: number;
  project: Map<string, number>;
  language: Map<string, number>;
  editor: Map<string, number>;
  /** Seconds by local hour of day (0-23), only when a time zone is given. */
  hour: Map<number, number>;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
export function localHour(unixSec: number, tz: string): number {
  let f = hourFormatters.get(tz);
  if (!f) hourFormatters.set(tz, (f = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz })));
  return Number(f.format(unixSec * 1000)) % 24;
}

/**
 * WakaTime-style duration: walk one merged timeline (all editors and agents
 * together) and credit each gap to the heartbeat that started it, unless the
 * gap exceeds the idle timeout. Merging first means an editor and an agent
 * running at the same moment are never double counted.
 */
export function computeDurations(beats: Beat[], timeout = IDLE_TIMEOUT_SEC, tz?: string): DayDurations {
  const sorted = [...beats].sort((a, b) => a.time - b.time);
  const out: DayDurations = { total: 0, ai: 0, project: new Map(), language: new Map(), editor: new Map(), hour: new Map() };
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const gap = sorted[i + 1].time - cur.time;
    if (gap <= 0 || gap > timeout) continue;
    out.total += gap;
    if (cur.category === "ai") out.ai += gap;
    add(out.project, cur.project, gap);
    add(out.language, cur.language, gap);
    add(out.editor, cur.editor, gap);
    if (tz) {
      const h = localHour(cur.time, tz);
      out.hour.set(h, (out.hour.get(h) ?? 0) + gap);
    }
  }
  return out;
}

/** "3h 12m", "45m", "0m". */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m`;
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Current and longest streak of consecutive active days. A streak is still
 * "current" if the last active day is today or yesterday (today may not have
 * started yet).
 */
export function streaks(activeDates: string[], today: string): { current: number; longest: number } {
  const set = new Set(activeDates);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev = "";
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

/** Heat level 0..4 from fixed thresholds so levels mean the same thing on every profile. */
export function heatLevel(sec: number): 0 | 1 | 2 | 3 | 4 {
  if (sec <= 0) return 0;
  if (sec < 30 * 60) return 1;
  if (sec < 2 * 3600) return 2;
  if (sec < 4 * 3600) return 3;
  return 4;
}
