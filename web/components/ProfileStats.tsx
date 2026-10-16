import Link from "next/link";
import { Hand, Robot } from "@phosphor-icons/react/ssr";
import type { User } from "@/lib/auth.ts";
import { insights, breakdown, dailySeries, projectList, summary, techStack, todayFor } from "@/lib/stats.ts";
import { addDays, formatDuration } from "@/lib/time.ts";
import { Heatmap } from "./Heatmap.tsx";
import { CountUp } from "./CountUp.tsx";
import { Card, Chip, EDITOR_NAMES, ShareBar } from "./ui.tsx";

export const RANGES = { "7d": 7, "30d": 30, "1y": 365 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(v: string | string[] | undefined): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "30d";
}

export async function ProfileStats({ user, range, owner, basePath }: { user: User; range: RangeKey; owner: boolean; basePath: string }) {
  const today = todayFor(user.timezone);
  const from = addDays(today, -(RANGES[range] - 1));
  const s = await summary(user.id, user.timezone);
  const cells = await dailySeries(user.id, addDays(today, -370), today);
  const languages = await breakdown(user.id, "language", from, today, 12);
  const editors = await breakdown(user.id, "editor", from, today, 8);
  const rangeTotal = languages.reduce((a, l) => a + l.seconds, 0);
  const rangeAi = cells.filter((c) => c.date >= from).reduce((a, c) => a + c.ai_seconds, 0);
  const showProjects = owner || !user.hide_projects;
  const projects = showProjects ? await projectList(user.id, from, today, 8) : [];
  const stack = await techStack(user.id, Math.floor(Date.now() / 1000) - 90 * 86400);
  const ins = await insights(user.id, user.timezone);
  const change = ins.lastWeek ? Math.round(((ins.thisWeek - ins.lastWeek) / ins.lastWeek) * 100) : null;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
  const insightCells = [
    {
      label: "vs last week",
      value: change === null ? (ins.thisWeek ? "New" : "–") : `${change > 0 ? "+" : ""}${change}%`,
      tone: change === null ? "" : change > 0 ? "up" : change < 0 ? "down" : "",
      hint: `${formatDuration(ins.thisWeek)} this week, ${formatDuration(ins.lastWeek)} the week before`,
    },
    {
      label: "Best weekday",
      value: ins.bestWeekday ? WEEKDAYS[ins.bestWeekday.day] : "–",
      tone: "",
      hint: ins.bestWeekday ? `Averages ${formatDuration(ins.bestWeekday.avg)}, last 12 weeks` : "Not enough data yet",
    },
    {
      label: "Peak hour",
      value: ins.peakHour ? hourLabel(ins.peakHour.hour) : "–",
      tone: "",
      hint: ins.peakHour ? `${Math.round(ins.peakHour.share * 100)}% of your time, last 30 days` : "Not enough data yet",
    },
  ];

  const tiles = [
    { label: "Today", value: s.today },
    { label: "Last 7 days", value: s.week },
    { label: "Daily average", value: s.dailyAvg, hint: "Active days, last 30" },
    { label: "Current streak", value: s.streak.current, int: true, hint: `Longest ${s.streak.longest} ${s.streak.longest === 1 ? "day" : "days"}` },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line shadow-card lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} className="rise bg-surface p-5 sm:p-6" style={{ ["--d" as string]: i }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">{t.label}</div>
            <div className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
              {t.int ? (
                <>
                  <CountUp value={t.value} as="int" /> <span className="text-base font-normal text-muted">{t.value === 1 ? "day" : "days"}</span>
                </>
              ) : (
                <CountUp value={t.value} />
              )}
            </div>
            {t.hint && <div className="mt-1 text-xs text-faint">{t.hint}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-line bg-line shadow-card sm:grid-cols-3">
        {insightCells.map((c, i) => (
          <div key={c.label} className="rise bg-surface p-5 sm:p-6" style={{ ["--d" as string]: i + 1 }}>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">{c.label}</div>
            <div
              className={`mt-2 font-display text-2xl font-medium tracking-tight sm:text-3xl ${
                c.tone === "up" ? "text-[#16a34a] [:root[data-theme=dark]_&]:text-[#4ade80]" : c.tone === "down" ? "text-muted" : ""
              }`}
            >
              {c.value}
            </div>
            <div className="mt-1 text-xs text-faint">{c.hint}</div>
          </div>
        ))}
      </div>

      <Card className="rise p-5 sm:p-6" style={{ ["--d" as string]: 2 }}>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-medium tracking-tight">
            <span className="num">{formatDuration(s.year)}</span> in the last year
          </h2>
          <span className="text-sm text-muted">
            {s.activeDays} active days
            {s.best && s.best.seconds > 0 && <> · best day {formatDuration(s.best.seconds)}</>}
          </span>
        </div>
        <Heatmap cells={cells} end={today} />
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-medium tracking-tight">Breakdown</h2>
        <div className="flex rounded-full border border-line bg-surface p-1 text-sm" role="tablist" aria-label="Time range">
          {(Object.keys(RANGES) as RangeKey[]).map((r) => (
            <Link
              key={r}
              href={`${basePath}?range=${r}`}
              scroll={false}
              role="tab"
              aria-selected={r === range}
              className={`rounded-full px-3 py-1 transition ${r === range ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
            >
              {r === "1y" ? "Year" : r === "7d" ? "7 days" : "30 days"}
            </Link>
          ))}
        </div>
      </div>

      {rangeTotal === 0 ? (
        <Card className="p-8 text-center text-muted">No tracked time in this range yet.</Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
          <Card className="p-5 sm:p-6">
            <h3 className="mb-4 font-medium">Languages</h3>
            <ShareBar items={languages} total={rangeTotal} />
          </Card>

          <Card className="p-5 sm:p-6">
            <h3 className="mb-4 font-medium">Hands-on vs AI agents</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-2 p-4">
                <Hand size={18} className="text-muted" />
                <div className="num mt-2 whitespace-nowrap text-xl font-semibold">{formatDuration(rangeTotal - rangeAi)}</div>
                <div className="text-xs text-muted">In the editor</div>
              </div>
              <div className="rounded-xl bg-accent-soft p-4">
                <Robot size={18} className="text-accent" />
                <div className="num mt-2 whitespace-nowrap text-xl font-semibold">{formatDuration(rangeAi)}</div>
                <div className="text-xs text-muted">AI agents</div>
              </div>
            </div>
            <ul className="mt-5 grid gap-2 text-sm">
              {editors.map((e) => (
                <li key={e.name} className="flex justify-between">
                  <span>{EDITOR_NAMES[e.name] ?? e.name}</span>
                  <span className="num text-muted">{formatDuration(e.seconds)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {stack.length > 0 && (
        <Card className="p-5 sm:p-6">
          <h3 className="mb-1 font-medium">Tech stack</h3>
          <p className="mb-4 text-sm text-muted">Detected from project manifests over the last 90 days.</p>
          <div className="flex flex-wrap gap-2">
            {stack.map((t) => <Chip key={t}>{t}</Chip>)}
          </div>
        </Card>
      )}

      {showProjects && projects.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between p-5 pb-3 sm:px-6">
            <h3 className="font-medium">Projects</h3>
            {owner && user.hide_projects ? <span className="text-xs text-faint">Hidden on your public profile</span> : null}
          </div>
          <ul>
            {projects.map((p) => (
              <li key={p.name} className="grid gap-2 border-t border-line px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  {p.stack.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.stack.slice(0, 6).map((t) => <Chip key={t}>{t}</Chip>)}
                    </div>
                  )}
                </div>
                <div className="num text-sm text-muted">{formatDuration(p.seconds)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
