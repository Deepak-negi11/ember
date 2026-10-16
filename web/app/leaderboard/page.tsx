import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth.ts";
import { boardLanguages, leaderboard, previousRanks } from "@/lib/stats.ts";
import { Champion } from "@/components/Champion.tsx";
import { Card } from "@/components/ui.tsx";
import { LeaderRows } from "@/components/LeaderRows.tsx";

const PERIODS = { "7d": { days: 7, label: "this week", prev: "last week", tab: "Last 7 days" }, "30d": { days: 30, label: "this month", prev: "the 30 days before", tab: "Last 30 days" } } as const;

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  if (lang) {
    return {
      title: `Top ${lang} developers this week`,
      description: `Developers who wrote the most ${lang} this week, ranked by tracked coding time on Ember.`,
      alternates: { canonical: `/leaderboard?lang=${encodeURIComponent(lang)}` },
    };
  }
  return {
    title: "Developer leaderboard: who coded the most this week",
    description: "Weekly and monthly rankings of developers by tracked coding time across VS Code, Cursor, Claude Code, Codex and Cursor Agent, with languages and AI-agent share.",
    alternates: { canonical: "/leaderboard" },
  };
}

export default async function Leaderboard({ searchParams }: Props) {
  const sp = await searchParams;
  const key = sp.range === "30d" ? "30d" : "7d";
  const period = PERIODS[key];
  const languages = await boardLanguages(period.days, 10);
  // Only accept languages that actually appear on the board.
  const lang = languages.find((l) => l.name === sp.lang)?.name;
  const [rows, prev, me] = await Promise.all([
    leaderboard(period.days, 100, { language: lang }),
    previousRanks(period.days, { language: lang }),
    currentUser(),
  ]);
  const max = rows[0]?.seconds ?? 1;
  const href = (range: string, language?: string) =>
    `/leaderboard?${new URLSearchParams({ ...(range !== "7d" ? { range } : {}), ...(language ? { lang: language } : {}) })}`.replace(/\?$/, "");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{lang ? `Top ${lang} developers` : "Leaderboard"}</h1>
          <p className="mt-2 max-w-[60ch] text-muted">
            {lang ? `Ranked by time spent in ${lang} ${period.label}.` : "Ranked by tracked coding time, editors and AI agents combined."} Arrows show the change since {period.prev}.
          </p>
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
          <p className="mt-2 text-muted">Install a collector and the first spot is yours.</p>
          <Link href="/#setup" className="mt-5 inline-block font-medium text-accent-text hover:underline">See setup</Link>
        </Card>
      ) : (
        <>
          {!lang && <Champion row={rows[0]} period={period.label} />}
          <div className={lang ? "" : "mt-6"}>
            <LeaderRows rows={rows} meId={me?.id} max={max} prevRanks={prev} language={lang} />
          </div>
        </>
      )}
    </div>
  );
}
