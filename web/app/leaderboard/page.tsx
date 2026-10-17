import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/ssr";
import { apiKeyInfo, currentUser } from "@/lib/auth.ts";
import { AI_DAILY_CAP_SEC, boardLanguages, leaderboard, leaderboard24h, previousRanks, type BoardMode } from "@/lib/stats.ts";
import { Champion } from "@/components/Champion.tsx";
import { Card, btn } from "@/components/ui.tsx";
import { LeaderRows } from "@/components/LeaderRows.tsx";

const PERIODS = {
  "24h": { days: 1, label: "in the last 24 hours", prev: "the 24 hours before", tab: "24 hours" },
  "7d": { days: 7, label: "this week", prev: "last week", tab: "Last 7 days" }, "30d": { days: 30, label: "this month", prev: "the 30 days before", tab: "Last 30 days" } } as const;

type Props = { searchParams: Promise<Record<string, string | undefined>> };


// Members only, so search engines don't index it.
export const metadata: Metadata = { title: "Leaderboard", robots: { index: false } };

export default async function Leaderboard({ searchParams }: Props) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const sp = await searchParams;
  const key = sp.range === "30d" ? "30d" : sp.range === "24h" ? "24h" : "7d";
  const period = PERIODS[key];
  const mode: BoardMode = sp.mode === "hands-on" ? "hands-on" : "all";
  const languages = await boardLanguages(period.days, 10);
  // Only accept languages that actually appear on the board.
  const lang = languages.find((l) => l.name === sp.lang)?.name;
  const [rows, prev, apiKey] = await Promise.all([
    key === "24h" ? leaderboard24h(100, { language: lang, mode }) : leaderboard(period.days, 100, { language: lang, mode }),
    key === "24h"
      ? leaderboard24h(10_000, { language: lang, mode, offsetHours: 24 }).then((r) => new Map(r.map((x) => [x.user_id, x.rank])))
      : previousRanks(period.days, { language: lang, mode }),
    apiKeyInfo(me.id),
  ]);
  const onBoard = rows.some((r) => r.user_id === me.id);
  const href = (range: string, language?: string, m: BoardMode = mode) =>
    `/leaderboard?${new URLSearchParams({
      ...(range !== "7d" ? { range } : {}),
      ...(language ? { lang: language } : {}),
      ...(m === "hands-on" ? { mode: m } : {}),
    })}`.replace(/\?$/, "");
  const capHours = AI_DAILY_CAP_SEC / 3600;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{lang ? `Top ${lang} developers` : "Leaderboard"}</h1>
          <p className="mt-2 max-w-[60ch] text-muted">
            {lang ? `Ranked by time spent in ${lang} ${period.label}` : "Ranked by tracked coding time"}
            {mode === "hands-on" ? ", written by hand: AI-agent time is not counted." : `, with AI-agent time counted up to ${capHours}h a day.`}{" "}
            {key !== "24h" && "Days end at each person's own midnight. "}Arrows show the change since {period.prev}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <div className="flex rounded-full border border-line bg-surface p-1 text-sm" role="tablist" aria-label="What counts">
          {([["all", "Combined"], ["hands-on", "Hands-on"]] as const).map(([m, label]) => (
            <Link
              key={m}
              href={href(key, lang, m)}
              role="tab"
              aria-selected={m === mode}
              className={`rounded-full px-3.5 py-1 transition ${m === mode ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="flex rounded-full border border-line bg-surface p-1 text-sm" role="tablist" aria-label="Period">
          {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((k) => (
            <Link
              key={k}
              href={href(k, lang)}
              role="tab"
              aria-selected={k === key}
              className={`rounded-full px-3.5 py-1 transition ${k === key ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
            >
              {PERIODS[k].tab}
            </Link>
          ))}
        </div>
        </div>
      </div>

      {(sp.welcome || (!apiKey && !onBoard)) && (
        <div className="rise mb-8 flex flex-col gap-4 rounded-3xl border border-line bg-surface-2/70 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-xl font-medium tracking-tight">{sp.welcome ? `Welcome to Ember, ${me.display_name.split(" ")[0]}.` : "You're not on the board yet."}</p>
            <p className="mt-1 text-muted">
              {apiKey
                ? "Your key is ready. Connect your editor and your time shows up here after a few minutes of coding."
                : "Create your API key and connect your editor. It takes about two minutes, then your time shows up here."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href="/settings#api-key" className={btn.primary}>{apiKey ? "View my key" : "Create API key"}</Link>
            <Link href="/setup" className={btn.secondary}>Setup guide <ArrowRight size={14} /></Link>
          </div>
        </div>
      )}

      {languages.length > 1 && (
        <nav aria-label="Filter by language" className="rise mb-8 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" style={{ ["--d" as string]: 1 }}>
          {[{ name: "", label: "All languages" }, ...languages.map((l) => ({ name: l.name, label: l.name }))].map((l) => {
            const active = (lang ?? "") === l.name;
            return (
              <Link
                key={l.label}
                href={href(key, l.name || undefined)}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-xl border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "border-ink bg-ink text-paper" : "border-line bg-surface text-muted hover:text-text"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      )}

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-lg font-medium">Nobody has tracked {lang ?? "time"} {period.label} yet.</p>
          {apiKey ? (
            <p className="mt-2 text-muted">You&apos;re set up. Write some code and the first spot is yours.</p>
          ) : (
            <>
              <p className="mt-2 text-muted">Install a collector and the first spot is yours.</p>
              <Link href="/setup" className="mt-5 inline-block font-medium text-accent-text hover:underline">Setup guide</Link>
            </>
          )}
        </Card>
      ) : (
        <>
          {!lang && <Champion row={rows[0]} period={period.label} />}
          <div className={lang ? "" : "mt-6"}>
            <LeaderRows rows={rows} meId={me?.id} prevRanks={prev} language={lang} />
          </div>
        </>
      )}
    </div>
  );
}
