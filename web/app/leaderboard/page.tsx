import Link from "next/link";
import { currentUser } from "@/lib/auth.ts";
import { leaderboard } from "@/lib/stats.ts";
import { Champion } from "@/components/Champion.tsx";
import { Card } from "@/components/ui.tsx";
import { LeaderRows } from "@/components/LeaderRows.tsx";

export const metadata = { title: "Leaderboard" };

const PERIODS = { "7d": { days: 7, label: "this week", tab: "Last 7 days" }, "30d": { days: 30, label: "this month", tab: "Last 30 days" } } as const;

export default async function Leaderboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const key = sp.range === "30d" ? "30d" : "7d";
  const period = PERIODS[key];
  const rows = await leaderboard(period.days, 100);
  const me = await currentUser();
  const max = rows[0]?.seconds ?? 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rise mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">Leaderboard</h1>
          <p className="mt-2 max-w-[60ch] text-muted">Ranked by tracked coding time, editors and AI agents combined.</p>
        </div>
        <div className="flex rounded-full border border-line bg-surface p-1 text-sm" role="tablist" aria-label="Period">
          {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((k) => (
            <Link
              key={k}
              href={`/leaderboard?range=${k}`}
              role="tab"
              aria-selected={k === key}
              className={`rounded-full px-3.5 py-1 transition ${k === key ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
            >
              {PERIODS[k].tab}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-lg font-medium">Nobody has tracked time {period.label} yet.</p>
          <p className="mt-2 text-muted">Install a collector and the first spot is yours.</p>
          <Link href="/#setup" className="mt-5 inline-block font-medium text-accent-text hover:underline">See setup</Link>
        </Card>
      ) : (
        <>
          <Champion row={rows[0]} period={period.label} />

          <div className="mt-6">
            <LeaderRows rows={rows} meId={me?.id} max={max} />
          </div>
        </>
      )}
    </div>
  );
}
