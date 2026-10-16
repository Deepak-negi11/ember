import { Hand, Robot } from "@phosphor-icons/react/ssr";
import { communityWeek } from "@/lib/stats.ts";
import { formatDuration } from "@/lib/time.ts";
import { HourChart } from "./HourChart.tsx";
import { EDITOR_NAMES } from "./ui.tsx";

const AGENTS = new Set(["claude-code", "codex"]);

/** "This week on Ember": live aggregates across every developer. */
export async function Community() {
  const w = await communityWeek();

  if (w.seconds === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line-strong p-10 text-center text-muted">
        Nobody has tracked time this week yet. The first heartbeat fills this in.
      </div>
    );
  }

  const handsOn = w.seconds - w.aiSeconds;
  const handsPct = Math.round((handsOn / w.seconds) * 100);
  const langMax = w.languages[0]?.seconds ?? 1;
  const langTotal = w.languages.reduce((a, l) => a + l.seconds, 0);

  return (
    <div className="grid gap-4 md:grid-cols-6">
      {/* Hour of day */}
      <section
        className="rounded-3xl border border-line p-6 shadow-card sm:p-8 md:col-span-4"
        style={{ background: "radial-gradient(120% 90% at 100% 0%, var(--accent-soft), transparent 60%), var(--surface)" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h3 className="font-display text-2xl font-medium tracking-tight">When people code</h3>
          <p className="text-sm text-muted">
            <span className="num font-semibold text-text">{formatDuration(w.seconds)}</span> by{" "}
            <span className="num font-semibold text-text">{w.devs}</span> {w.devs === 1 ? "developer" : "developers"}, in their own time zones
          </p>
        </div>
        <div className="mt-6">
          <HourChart hours={w.hours} />
        </div>
      </section>

      {/* Languages */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8 md:col-span-2">
        <h3 className="font-display text-2xl font-medium tracking-tight">Top languages</h3>
        <ol className="mt-6 grid gap-4">
          {w.languages.map((l, i) => (
            <li key={l.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">
                  <span className="num mr-2 text-faint">{i + 1}</span>
                  {l.name}
                </span>
                <span className="num text-muted">{Math.round((l.seconds / langTotal) * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(4, (l.seconds / langMax) * 100)}%`, opacity: 0.35 + 0.65 * (l.seconds / langMax) }} />
            </li>
          ))}
        </ol>
      </section>

      {/* Hands-on vs agents */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8 md:col-span-2">
        <h3 className="font-display text-2xl font-medium tracking-tight">Keyboard vs agents</h3>
        <p className="mt-6 font-display text-5xl font-medium tracking-tight tabular-nums">
          {handsPct}%
        </p>
        <p className="mt-1 text-sm text-muted">of this week was hands-on in an editor.</p>
        <div className="mt-5 flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          <span className="bg-ink" style={{ flexGrow: handsOn }} />
          <span className="bg-accent" style={{ flexGrow: w.aiSeconds }} />
        </div>
        <ul className="mt-5 grid gap-2 text-sm">
          {w.editors.map((e) => (
            <li key={e.name} className="flex items-center gap-2.5">
              {AGENTS.has(e.name) ? <Robot size={15} className="text-accent" /> : <Hand size={15} className="text-muted" />}
              <span className="flex-1">{EDITOR_NAMES[e.name] ?? e.name}</span>
              <span className="num text-muted">{formatDuration(e.seconds)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Stacks */}
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8 md:col-span-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="font-display text-2xl font-medium tracking-tight">What people are building with</h3>
          <p className="text-sm text-muted">
            Across <span className="num font-semibold text-text">{w.projects}</span> active {w.projects === 1 ? "project" : "projects"}
          </p>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2.5">
          {w.stacks.map((s, i) => (
            <li
              key={s.name}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 ${
                i < 3 ? "border-accent/30 bg-accent-soft text-base font-semibold" : "border-line bg-surface-2 text-sm font-medium"
              }`}
            >
              {s.name}
              <span className="num text-xs font-normal text-muted">{s.projects}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-faint">Detected from package.json, Cargo.toml, pyproject.toml, go.mod and other manifests. Counts are projects, not people.</p>
      </section>
    </div>
  );
}
