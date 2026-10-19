import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/ssr";
import { apiKeyInfo, currentUser } from "@/lib/auth.ts";
import { CODING_MODE, aiLeaderboard, boardLanguages, leaderboard, previousAiRanks, previousRanks } from "@/lib/stats.ts";
import { formatDuration } from "@/lib/time.ts";
import { formatTokens, modelName } from "@/lib/usage.ts";
import { AiLeaderRows } from "@/components/AiLeaderRows.tsx";
import { BoardMenu, type BoardOption } from "@/components/BoardMenu.tsx";
import { Champion } from "@/components/Champion.tsx";
import { Card, btn } from "@/components/ui.tsx";
import { LeaderRows } from "@/components/LeaderRows.tsx";

// Every period is whole calendar days in each person's own time zone: "Today"
// starts at their midnight, so the board resets as each person's day begins.
const PERIODS = {
  today: { days: 1, label: "today", prev: "yesterday", tab: "Today" },
  "7d": { days: 7, label: "this week", prev: "last week", tab: "7 days" },
  "30d": { days: 30, label: "this month", prev: "the 30 days before", tab: "30 days" },
} as const;
type PeriodKey = keyof typeof PERIODS;

const BOARDS = {
  coding: { label: "Coding", description: "Time each person spent writing code themselves." },
  ai: { label: "Agents", description: "Tokens and estimated spend from Claude Code and Codex." },
} as const;
type BoardKey = keyof typeof BOARDS;

type Props = { searchParams: Promise<Record<string, string | undefined>> };

// Members only, so search engines don't index it.
export const metadata: Metadata = { title: "Leaderboard", robots: { index: false } };

function Tabs({ label, items }: { label: string; items: { key: string; label: string; href: string; active: boolean }[] }) {
  return (
    <nav className="flex rounded-full border border-line bg-surface p-1 text-sm" aria-label={label}>
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.active ? "true" : undefined}
          className={`whitespace-nowrap rounded-full px-3.5 py-1 transition-colors ${t.active ? "bg-surface-2 text-text shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-text"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function Leaderboard({ searchParams }: Props) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const sp = await searchParams;
  const board: BoardKey = sp.board === "ai" ? "ai" : "coding";
  // "24h" was the rolling window this replaced; old links land on Today.
  const key: PeriodKey = sp.range === "30d" ? "30d" : sp.range === "today" || sp.range === "24h" ? "today" : "7d";
  const period = PERIODS[key];

  const href = (o: { board?: BoardKey; range?: PeriodKey; lang?: string }) => {
    const b = o.board ?? board;
    const range = o.range ?? key;
    const q = new URLSearchParams({
      ...(b !== "coding" ? { board: b } : {}),
      ...(range !== "7d" ? { range } : {}),
      ...(b === "coding" && o.lang ? { lang: o.lang } : {}),
    });
    return `/leaderboard${q.size ? `?${q}` : ""}`;
  };

  const options: BoardOption[] = (Object.keys(BOARDS) as BoardKey[]).map((b) => ({ key: b, ...BOARDS[b], href: href({ board: b }) }));
  const periodTabs = (Object.keys(PERIODS) as PeriodKey[]).map((k) => ({ key: k, label: PERIODS[k].tab, href: href({ range: k, lang: sp.lang }), active: k === key }));
  const apiKey = await apiKeyInfo(me.id);
  const resetNote = key === "today" ? "Today resets at midnight in each person's own time zone." : "Days end at each person's own midnight.";

  let header: { title: string; subtitle: string };
  let body: React.ReactNode;
  let onBoard: boolean;

  if (board === "ai") {
    const [rows, prev] = await Promise.all([aiLeaderboard(period.days, 100), previousAiRanks(period.days)]);
    onBoard = rows.some((r) => r.user_id === me.id);
    header = {
      title: BOARDS.ai.label,
      subtitle: `Ranked by AI tokens used ${period.label} in Claude Code and Codex, with the estimated spend under each. ${resetNote} Arrows compare with ${period.prev}.`,
    };
    const top = rows[0];
    body = rows.length === 0 ? (
      <Card className="p-10 text-center">
        <p className="text-lg font-medium">No agent tokens tracked {period.label} yet.</p>
        <p className="mx-auto mt-2 max-w-[52ch] text-muted">
          Token counts come from the Claude Code and Codex hooks: only the model name and token numbers, never prompts or code.
        </p>
        <Link href="/setup" className="mt-5 inline-block font-medium text-accent-text hover:underline">Connect an agent</Link>
      </Card>
    ) : (
      <>
        <Champion
          row={top}
          period={period.label}
          stat={`${formatTokens(top.tokens)} tokens`}
          chips={top.models.map((m) => ({ name: modelName(m.name), value: formatTokens(m.tokens) }))}
          chipsTitle={`Models ${period.label}`}
        />
        <div className="mt-6">
          <AiLeaderRows rows={rows} meId={me.id} prevRanks={prev} />
        </div>
        <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-faint">
          Spend is what the tokens would cost at standard API list prices. Subscriptions such as Claude Max or ChatGPT plans bill differently, so it is not what anyone paid.
        </p>
      </>
    );
  } else {
    const languages = await boardLanguages(period.days, 10);
    // Only accept languages that actually appear on the board.
    const lang = languages.find((l) => l.name === sp.lang)?.name;
    // Time people wrote code themselves; agent work is ranked on the Agents board.
    const [rows, prev] = await Promise.all([
      leaderboard(period.days, 100, { language: lang, mode: CODING_MODE }),
      previousRanks(period.days, { language: lang, mode: CODING_MODE }),
    ]);
    onBoard = rows.some((r) => r.user_id === me.id);
    header = {
      title: lang ? `Top ${lang} developers` : BOARDS.coding.label,
      subtitle: `${lang ? `Ranked by time spent writing ${lang} ${period.label}` : `Ranked by time spent writing code ${period.label}`}. ${resetNote} Arrows compare with ${period.prev}.`,
    };
    body = (
      <>
        {languages.length > 1 && (
          <nav aria-label="Filter by language" className="rise mb-8 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" style={{ ["--d" as string]: 1 }}>
            {[{ name: "", label: "All languages" }, ...languages.map((l) => ({ name: l.name, label: l.name }))].map((l) => {
              const active = (lang ?? "") === l.name;
              return (
                <Link
                  key={l.label}
                  href={href({ lang: l.name || undefined })}
                  scroll={false}
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
            {!lang && (
              <Champion
                row={rows[0]}
                period={period.label}
                stat={formatDuration(rows[0].seconds)}
                chips={rows[0].languages.map((l) => ({ name: l.name, value: formatDuration(l.seconds) }))}
                chipsTitle={`Languages ${period.label}`}
              />
            )}
            <div className={lang ? "" : "mt-6"}>
              <LeaderRows rows={rows} meId={me.id} prevRanks={prev} language={lang} />
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      {/* z-10: the board menu opens over the cards below (their own stacking contexts) but under the site header. */}
      <div className="rise relative z-10 mb-8">
        <p className="mb-2 text-sm font-medium text-muted">Leaderboard</p>
        {/* Title and description on the left, the period (and sort) tabs pinned to the right. */}
        <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <h1><BoardMenu current={board} options={options} /></h1>
            {header.title !== BOARDS[board].label && <p className="mt-3 font-display text-xl font-medium tracking-tight">{header.title}</p>}
            <p className="mt-3 max-w-[56ch] text-pretty text-muted">{header.subtitle}</p>
          </div>
          <div className="justify-self-start lg:justify-self-end">
            <Tabs label="Period" items={periodTabs} />
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

      {body}
    </div>
  );
}
