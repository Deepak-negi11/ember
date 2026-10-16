import Link from "next/link";
import { ArrowRight, Fire } from "@phosphor-icons/react/ssr";
import { publicOrigin } from "@/lib/origin.ts";
import { currentUser, userByUsername } from "@/lib/auth.ts";
import { breakdown, dailySeries, leaderboard, siteTotals, summary, todayFor } from "@/lib/stats.ts";
import { addDays, formatDuration } from "@/lib/time.ts";
import type { HeatCell } from "@/components/Heatmap.tsx";
import { LivePreview } from "@/components/LivePreview.tsx";
import { Community } from "@/components/Community.tsx";
import { SetupTabs } from "@/components/SetupTabs.tsx";
import { Champion } from "@/components/Champion.tsx";
import { Avatar, Label, btn } from "@/components/ui.tsx";

/** Deterministic sample year for an empty install, clearly labelled in the UI. */
function sampleYear(end: string): HeatCell[] {
  const out: HeatCell[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 365; i++) {
    const date = addDays(end, -i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const busy = (dow === 0 || dow === 6 ? 0.35 : 0.8) * (0.6 + 0.4 * Math.sin(i / 40));
    if (rand() < busy) out.push({ date, seconds: Math.round(rand() * rand() * 6 * 3600), ai_seconds: Math.round(rand() * 1800) });
  }
  return out;
}

function SectionHead({ label, title, sub }: { label?: string; title: string; sub: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-14">
      {label && <Label>{label}</Label>}
      <h2 className="mt-4 font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">{title}</h2>
      <p className="mx-auto mt-4 max-w-[52ch] text-lg leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

export default async function Home() {
  const user = await currentUser();
  const board = await leaderboard(7, 6);
  const leader = board[0] ? await userByUsername(board[0].username) : null;
  const end = todayFor(leader?.timezone ?? "UTC");

  let cells: HeatCell[];
  let languages: { name: string; seconds: number }[];
  let dailyAvg: number;
  let leaderSummary: Awaited<ReturnType<typeof summary>> | null = null;
  if (leader) {
    cells = await dailySeries(leader.id, addDays(end, -370), end);
    languages = await breakdown(leader.id, "language", addDays(end, -29), end, 5);
    leaderSummary = await summary(leader.id, leader.timezone);
    dailyAvg = leaderSummary.dailyAvg;
  } else {
    cells = sampleYear(end);
    languages = [{ name: "TypeScript", seconds: 41000 }, { name: "Rust", seconds: 23000 }, { name: "Python", seconds: 9000 }];
    dailyAvg = 9600;
  }
  const yearCells = cells.filter((c) => c.date >= addDays(end, -364));
  const total = yearCells.reduce((a, c) => a + c.seconds, 0);
  const bestDay = yearCells.reduce((m, c) => Math.max(m, c.seconds), 0);
  const ai = yearCells.reduce((a, c) => a + c.ai_seconds, 0);
  const totals = await siteTotals();
  const origin = await publicOrigin();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-x-clip">
        <div aria-hidden className="ember-pool absolute left-1/2 top-24 h-80 w-[46rem] max-w-full -translate-x-1/2" />
        <div className="relative mx-auto flex max-w-5xl flex-col items-center px-5 pb-28 pt-10 text-center sm:px-6 md:pb-36 md:pt-20">
          <Link
            href="/leaderboard"
            className="rise inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface/80 py-1.5 pl-2 pr-3.5 text-[13px] text-muted shadow-card backdrop-blur transition-colors hover:text-text sm:text-sm"
          >
            <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent">
              <Fire size={13} weight="fill" />
            </span>
            <span>
              <span className="num font-semibold text-text">{Math.round(totals.seconds / 3600).toLocaleString("en-US")}h</span> tracked by{" "}
              {totals.devs} {totals.devs === 1 ? "developer" : "developers"}
            </span>
            <ArrowRight size={13} />
          </Link>

          {/* Font scales with the viewport so the headline is always exactly two lines. */}
          <h1
            className="rise mt-8 font-display font-medium leading-[1.05] tracking-tight"
            style={{ ["--d" as string]: 1, fontSize: "clamp(26px, 8.4vw, 88px)" }}
          >
            <span className="block whitespace-nowrap">Proof you showed up,</span>
            <span className="block whitespace-nowrap">every single day.</span>
          </h1>

          <p className="rise mt-7 max-w-[52ch] text-lg leading-relaxed text-muted sm:text-xl" style={{ ["--d" as string]: 2 }}>
            Ember tracks time in VS Code, Cursor, Claude Code and Codex, and lights up your year one square at a time.
          </p>

          <div className="rise mt-10 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row" style={{ ["--d" as string]: 3 }}>
            <Link href={user ? "/dashboard" : "/login"} className={btn.primary + " sm:px-7"}>
              {user ? "Open dashboard" : "Start tracking"} <ArrowRight size={16} weight="bold" />
            </Link>
            <Link href="#setup" className={btn.secondary + " sm:px-7"}>
              How to set up
            </Link>
          </div>
        </div>
      </section>

      {/* Live preview */}
      <section id="live" className="mx-auto max-w-6xl scroll-mt-28 px-5 pb-28 sm:px-6">
        <SectionHead
          label="Live"
          title={leader ? `${leader.display_name.split(" ")[0]}'s year, live` : "A year at a glance"}
          sub={leader ? "Real data from this week's #1. Hover any day to see the hours behind it." : "Sample data. Your own heatmap fills in as soon as a collector sends its first heartbeat."}
        />
        <LivePreview
          cells={cells}
          end={end}
          languages={languages}
          bestDay={bestDay}
          dailyAvg={dailyAvg}
          aiShare={total ? Math.round((ai / total) * 100) : 0}
        />
      </section>

      {/* Community, live */}
      <section id="community" className="scroll-mt-28 border-t border-line bg-surface-2/60">
        <div className="mx-auto max-w-6xl px-5 py-28 sm:px-6">
          <SectionHead label="This week" title="This week on Ember" sub="Live totals from everyone tracking with Ember over the last 7 days." />
          <Community />
        </div>
      </section>

      {/* Leaderboard */}
      {board.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-28 sm:px-6">
          <SectionHead title="Who's burning brightest" sub="Ranked by tracked time over the last 7 days. The #1 spot gets the stage, and their words." />
          <Champion row={board[0]} period="this week" />
          {board.length > 1 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {board.slice(1, 6).map((r) => (
                <Link
                  key={r.user_id}
                  href={`/u/${r.username}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <span className="num w-4 text-sm font-semibold text-faint">{r.rank}</span>
                  <Avatar name={r.display_name} src={r.avatar_url} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{r.display_name}</span>
                    <span className="num block text-xs text-muted">{formatDuration(r.seconds)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-10 text-center">
            <Link href="/leaderboard" className={btn.secondary}>
              Full leaderboard <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      )}

      {/* Setup */}
      <section id="setup" className="scroll-mt-28 border-y border-line bg-surface-2/60">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-28 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <Label>Setup</Label>
            <h2 className="mt-4 font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl">One key. Every editor and agent.</h2>
            <p className="mt-5 max-w-[44ch] text-lg leading-relaxed text-muted">
              Install the CLI with npm or bun and run one command. It connects VS Code, Cursor, Windsurf, Claude Code and Codex, and queues activity while you are offline.
            </p>
          </div>
          <div className="min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
            <SetupTabs origin={origin} />
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="relative overflow-hidden border-t border-line">
        <div aria-hidden className="ember-pool absolute left-1/2 top-1/2 h-72 w-[42rem] max-w-full -translate-x-1/2 -translate-y-1/2" />
        <div className="relative mx-auto max-w-4xl px-5 py-28 text-center sm:px-6">
          <h2 className="font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
            Your first glowing square is <span className="text-accent">one save away.</span>
          </h2>
          {totals.devs > 0 && (
            <p className="mt-5 text-lg text-muted">
              <span className="num font-semibold text-text">{formatDuration(totals.seconds)}</span> tracked by{" "}
              <span className="num font-semibold text-text">{totals.devs}</span> {totals.devs === 1 ? "developer" : "developers"} so far.
            </p>
          )}
          <div className="mt-10">
            <Link href={user ? "/settings#api-key" : "/login"} className={btn.primary}>
              {user ? "Get your API key" : "Start tracking"}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
