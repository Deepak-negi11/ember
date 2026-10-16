"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Heatmap, type HeatCell } from "./Heatmap.tsx";
import { CountUp } from "./CountUp.tsx";

const RAMP = ["var(--h4)", "var(--h3)", "var(--h2)", "var(--h1)", "var(--line-strong)"];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function LivePreview({
  cells, end, languages, bestDay, dailyAvg, aiShare,
}: {
  cells: HeatCell[];
  end: string;
  languages: { name: string; seconds: number }[];
  bestDay: number;
  dailyAvg: number;
  aiShare: number;
}) {
  const [view, setView] = useState<"heatmap" | "breakdown">("heatmap");
  const reduce = useReducedMotion();
  const langTotal = languages.reduce((a, l) => a + l.seconds, 0) || 1;

  return (
    <div>
      <div className="mx-auto mb-8 flex w-fit rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Preview view">
        {(["heatmap", "breakdown"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className="relative rounded-lg px-5 py-2 text-sm font-semibold capitalize"
          >
            {view === v && (
              <motion.span
                layoutId="live-pill"
                className="absolute inset-0 rounded-lg bg-ink"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className={`relative transition-colors ${view === v ? "text-paper" : "text-muted hover:text-text"}`}>{v}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
        <div className="min-h-[248px] border-b border-line p-5 sm:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {view === "heatmap" ? (
                <Heatmap cells={cells} end={end} />
              ) : (
                <div className="grid gap-6 md:grid-cols-[1fr_1.2fr] md:items-center">
                  <div>
                    <div className="flex h-3 gap-1 overflow-hidden rounded-full">
                      {languages.map((l, i) => (
                        <motion.span
                          key={l.name}
                          className="origin-left"
                          style={{ flexGrow: l.seconds, background: RAMP[i] ?? RAMP[4] }}
                          initial={reduce ? false : { scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: 0.7, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                        />
                      ))}
                    </div>
                    <p className="mt-4 text-sm text-muted">Languages over the last 30 days.</p>
                  </div>
                  <ul className="grid gap-3">
                    {languages.map((l, i) => (
                      <li key={l.name} className="flex items-center gap-3 text-sm">
                        <span className="size-2.5 rounded-full" style={{ background: RAMP[i] ?? RAMP[4] }} />
                        <span className="flex-1 font-medium">{l.name}</span>
                        <span className="num text-muted">{fmt(l.seconds)}</span>
                        <span className="num w-10 text-right text-faint">{Math.round((l.seconds / langTotal) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { label: "Daily average", node: <CountUp value={dailyAvg} /> },
            { label: "Best single day", node: <CountUp value={bestDay} /> },
            { label: "With AI agents", node: <span className="text-accent"><CountUp value={aiShare} as="int" />%</span> },
          ].map((s) => (
            <div key={s.label} className="px-6 py-6 sm:px-8">
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">{s.label}</dt>
              <dd className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">{s.node}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
