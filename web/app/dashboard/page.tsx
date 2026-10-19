import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Trophy } from "@phosphor-icons/react/ssr";
import { apiKeyInfo, currentUser } from "@/lib/auth.ts";
import { get } from "@/lib/db.ts";
import { CODING_MODE, leaderboard, previousRanks } from "@/lib/stats.ts";
import { LeaderRows } from "@/components/LeaderRows.tsx";
import { YourTools } from "@/components/YourTools.tsx";
import { ProfileStats, parseRange } from "@/components/ProfileStats.tsx";
import { Card, btn } from "@/components/ui.tsx";
import { formatDuration } from "@/lib/time.ts";

export const metadata = { title: "Dashboard", robots: { index: false } };

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const hasData = !!await get("SELECT 1 AS x FROM heartbeats WHERE user_id = ? LIMIT 1", user.id);
  const key = await apiKeyInfo(user.id);
  const [board, prev] = await Promise.all([leaderboard(7, 1000, { mode: CODING_MODE }), previousRanks(7, { mode: CODING_MODE })]);
  const mineIdx = board.findIndex((r) => r.user_id === user.id);
  const rank = mineIdx === -1 ? null : { rank: mineIdx + 1, of: board.length };
  // Top 5, plus your own row if you are further down.
  const shown = mineIdx > 4 ? [...board.slice(0, 5), board[mineIdx]] : board.slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rise mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted">{greeting(user.timezone)},</p>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{user.display_name}</h1>
        </div>
        {rank && (
          <Link
            href="/leaderboard"
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm transition hover:border-line-strong"
          >
            <Trophy size={16} weight="fill" className="text-accent" />
            <span>
              Ranked <span className="num font-semibold">#{rank.rank}</span> of {rank.of} this week
            </span>
          </Link>
        )}
      </div>

      {!hasData && (
        <Card className="rise mb-8 p-6 sm:p-8">
          <h2 className="font-display text-2xl font-medium tracking-tight">Connect your editor to start the heatmap</h2>
          <ol className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
            <li className="rounded-xl bg-surface-2 p-4">
              <div className="font-medium">Create your API key</div>
              <p className="mt-1 text-muted">{key ? `Active key ending in ${key.hint}.` : "One key works for every editor and agent."}</p>
            </li>
            <li className="rounded-xl bg-surface-2 p-4">
              <div className="font-medium">Install a collector</div>
              <p className="mt-1 text-muted">One command connects VS Code, Cursor, Claude Code, Codex and Cursor&apos;s agent.</p>
            </li>
            <li className="rounded-xl bg-surface-2 p-4">
              <div className="font-medium">Write some code</div>
              <p className="mt-1 text-muted">Time appears here within about 30 seconds.</p>
            </li>
          </ol>
          <Link
            href="/settings#api-key"
            className={`mt-6 ${btn.primary}`}
          >
            {key ? "View setup" : "Create API key"} <ArrowRight size={16} />
          </Link>
        </Card>
      )}

      {shown.length > 0 && (
        <section className="rise mb-10" style={{ ["--d" as string]: 1 }} aria-labelledby="board-title">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="board-title" className="font-display text-2xl font-medium tracking-tight">Coding this week</h2>
              <p className="mt-1 text-sm text-muted">
                {rank ? <>You are <span className="num font-semibold text-text">#{rank.rank}</span> of {rank.of}.{rank.rank > 1 && <> {formatDuration(board[rank.rank - 2].seconds - board[rank.rank - 1].seconds)} behind #{rank.rank - 1}.</>}</> : "Track some time this week to get on the board."}
              </p>
            </div>
            <Link href="/leaderboard" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent-text hover:underline">
              Full leaderboard <ArrowRight size={14} />
            </Link>
          </div>
          <LeaderRows rows={shown} meId={user.id} gapBefore={mineIdx > 4 ? mineIdx + 1 : undefined} prevRanks={prev} />
        </section>
      )}

      <div className="rise mb-10" style={{ ["--d" as string]: 2 }}>
        <YourTools userId={user.id} timezone={user.timezone} />
      </div>

      <h2 className="mb-4 font-display text-2xl font-medium tracking-tight">Your stats</h2>
      <ProfileStats user={user} range={range} owner basePath="/dashboard" />
    </div>
  );
}
