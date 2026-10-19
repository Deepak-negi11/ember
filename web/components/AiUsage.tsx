import { Coins, Sparkle } from "@phosphor-icons/react/ssr";
import type { AiSummary, AiTotals } from "@/lib/stats.ts";
import { formatCost, formatTokens, modelName } from "@/lib/usage.ts";
import { Card, EDITOR_NAMES } from "./ui.tsx";

const MIX: { key: keyof AiTotals; label: string; color: string }[] = [
  { key: "cache_read", label: "Cache reads", color: "var(--h2)" },
  { key: "cache_write", label: "Cache writes", color: "var(--h1)" },
  { key: "input", label: "Input", color: "var(--h3)" },
  { key: "output", label: "Output", color: "var(--h4)" },
];

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
        {icon}
        {label}
      </div>
      <div className="num mt-2 truncate text-3xl font-semibold tracking-tight sm:text-4xl">{value}</div>
      <div className="mt-1 text-xs text-muted">{hint}</div>
    </div>
  );
}

/**
 * Tokens and estimated spend from AI agents for the selected range, with today
 * and all-time totals, the token mix and a per-model split. Shared by the
 * dashboard and the public profile.
 */
export function AiUsage({ s, rangeLabel, owner }: { s: AiSummary; rangeLabel: string; owner: boolean }) {
  const r = s.range;
  if (s.allTime.tokens === 0) {
    if (!owner) return null;
    return (
      <Card className="p-5 sm:p-6">
        <h3 className="flex items-center gap-2 font-medium"><Sparkle aria-hidden size={18} weight="duotone" className="text-accent" /> AI usage</h3>
        <p className="mt-2 max-w-[62ch] text-sm text-muted">
          No token data yet. The Claude Code and Codex hooks send the model name and token counts at the end of each turn, never prompts or code. Update them with{" "}
          <code className="num rounded bg-surface-2 px-1 text-[13px] text-text">npm install -g embertime@latest</code> and your next agent turn shows up here.
        </p>
      </Card>
    );
  }
  const unpriced = r.models.filter((m) => !m.priced);
  const maxModel = Math.max(1, ...r.models.map((m) => m.tokens));

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 font-medium"><Sparkle aria-hidden size={18} weight="duotone" className="text-accent" /> AI usage, {rangeLabel}</h3>
        <span className="text-xs text-faint">
          All time <span className="num text-muted">{formatTokens(s.allTime.tokens)}</span> tokens ·{" "}
          <span className="num text-muted">{formatCost(s.allTime.cost_micros)}</span>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          icon={<Sparkle aria-hidden size={13} weight="bold" />}
          label="Tokens"
          value={formatTokens(r.tokens)}
          hint={`Today ${formatTokens(s.today.tokens)} · ${formatTokens(r.output)} written by models`}
        />
        <Stat
          icon={<Coins aria-hidden size={13} weight="bold" />}
          label="Est. spend"
          value={formatCost(r.cost_micros)}
          hint={`Today ${formatCost(s.today.cost_micros)} · at API list prices`}
        />
      </div>

      {r.tokens > 0 ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h4 className="mb-3 text-sm font-medium">Token mix</h4>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {MIX.filter((m) => r[m.key] > 0).map((m) => (
                <span key={m.key} style={{ flexGrow: r[m.key], background: m.color }} />
              ))}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {MIX.map((m) => (
                <li key={m.key} className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: m.color }} />
                  <span className="min-w-0 flex-1 truncate text-muted">{m.label}</span>
                  <span className="num">{formatTokens(r[m.key])}</span>
                </li>
              ))}
            </ul>
            {r.agents.length > 0 && (
              <p className="mt-4 text-xs text-faint">
                {r.agents.map((a) => `${EDITOR_NAMES[a.name] ?? a.name} ${formatTokens(a.tokens)}`).join(" · ")}
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium">By model</h4>
            <ul className="grid gap-3">
              {r.models.slice(0, 5).map((m) => (
                <li key={m.name} className="text-sm">
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate" title={m.name}>{modelName(m.name)}</span>
                    <span className="num text-muted">{formatTokens(m.tokens)}</span>
                    <span className="num w-16 text-right">{m.priced ? formatCost(m.cost_micros) : "–"}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-[var(--h3)]" style={{ width: `${Math.max(2, (m.tokens / maxModel) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            {r.models.length > 5 && <p className="mt-3 text-xs text-faint">+{r.models.length - 5} more models</p>}
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">No agent tokens in this range.</p>
      )}

      <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-faint">
        Spend is an estimate at standard API list prices; subscriptions like Claude Max or ChatGPT plans bill differently.
        {unpriced.length > 0 && ` No price on file for ${unpriced.map((m) => m.name).join(", ")}, so those tokens count as $0.`}
      </p>
    </Card>
  );
}
