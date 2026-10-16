"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "motion/react";

export interface HeatCell { date: string; seconds: number; ai_seconds: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function level(sec: number) {
  if (sec <= 0) return 0;
  if (sec < 1800) return 1;
  if (sec < 7200) return 2;
  if (sec < 14400) return 3;
  return 4;
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * GitHub-style year grid: 53 week columns, Sunday on top. `end` is "today" in
 * the profile owner's time zone so the last column is always the current week.
 */
export function Heatmap({ cells, end, compact = false }: { cells: HeatCell[]; end: string; compact?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Start the cell wave only once the grid is actually on screen.
  const inView = useInView(scroller, { once: true, amount: 0.35 });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const { weeks, months } = useMemo(() => {
    const byDate = new Map(cells.map((c) => [c.date, c]));
    const endD = toDate(end);
    const start = new Date(endD);
    start.setUTCDate(start.getUTCDate() - 364 - start.getUTCDay());

    const weeks: (HeatCell & { future: boolean })[][] = [];
    const months: { col: number; label: string }[] = [];
    const cursor = new Date(start);
    for (let w = 0; cursor <= endD; w++) {
      const week: (HeatCell & { future: boolean })[] = [];
      for (let d = 0; d < 7; d++) {
        const key = iso(cursor);
        const c = byDate.get(key);
        week.push({ date: key, seconds: c?.seconds ?? 0, ai_seconds: c?.ai_seconds ?? 0, future: cursor > endD });
        if (cursor.getUTCDate() === 1 || (w === 0 && d === 0)) {
          const prev = months.at(-1);
          if (!prev || w - prev.col >= 3) months.push({ col: w, label: MONTHS[cursor.getUTCMonth()] });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      weeks.push(week);
    }
    // A label squeezed into the first column usually collides with the next one.
    if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();
    return { weeks, months };
  }, [cells, end]);

  // Start scrolled to the most recent weeks on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  // Cells are fluid: they grow to fill the container, and below `size` the
  // grid stops shrinking and scrolls horizontally instead.
  const size = compact ? 10 : 11;
  const gap = 3;

  function show(e: React.MouseEvent<HTMLDivElement>, c: HeatCell) {
    const host = scroller.current!.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const d = toDate(c.date);
    const when = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    const ai = c.seconds && c.ai_seconds ? `, ${Math.round((c.ai_seconds / c.seconds) * 100)}% with AI agents` : "";
    setTip({
      x: r.left - host.left + scroller.current!.scrollLeft + r.width / 2,
      y: r.top - host.top,
      text: c.seconds ? `${fmt(c.seconds)} on ${when}${ai}` : `No activity on ${when}`,
    });
  }

  const totalDays = cells.filter((c) => c.seconds > 0).length;

  return (
    <div>
      <div
        ref={scroller}
        data-in={inView ? "true" : "false"}
        className="relative overflow-x-auto pb-2 [scrollbar-width:thin]"
        role="img"
        aria-label={`Activity heatmap: ${totalDays} active days in the last year`}
        onMouseLeave={() => setTip(null)}
      >
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `28px repeat(${weeks.length}, minmax(${size}px, 1fr))`, columnGap: gap, rowGap: gap, maxWidth: 28 + weeks.length * 21 }}
        >
          {/* Month labels */}
          <div />
          <div className="relative h-4" style={{ gridColumn: `2 / span ${weeks.length}` }} aria-hidden>
            {months.map((m) => (
              <span key={`${m.label}-${m.col}`} className="absolute top-0 text-[11px] text-muted" style={{ left: `${(m.col / weeks.length) * 100}%` }}>
                {m.label}
              </span>
            ))}
          </div>

          {/* Weekday labels + cells, row by row */}
          {Array.from({ length: 7 }, (_, row) => (
            <Row key={row} row={row} weeks={weeks} onEnter={show} />
          ))}
        </div>

        {tip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-text shadow-card"
            style={{ left: tip.x, top: tip.y - 6 }}
          >
            {tip.text}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>Counts time spent writing code, with breaks under 15 minutes.</span>
        <span className="flex items-center gap-1.5" aria-label="Legend: less than 30 minutes to more than 4 hours">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`heat-${l} inline-block size-[11px] rounded-[3px]`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

function Row({
  row, weeks, onEnter,
}: {
  row: number;
  weeks: (HeatCell & { future: boolean })[][];
  onEnter: (e: React.MouseEvent<HTMLDivElement>, c: HeatCell) => void;
}) {
  return (
    <>
      <span className="flex items-center pr-1 text-[11px] leading-none text-muted" aria-hidden>
        {row % 2 === 1 ? WEEKDAYS[row] : ""}
      </span>
      {weeks.map((week, col) => {
        const c = week[row];
        if (c.future) return <span key={c.date} className="aspect-square" />;
        return (
          <div
            key={c.date}
            aria-hidden
            onMouseEnter={(e) => onEnter(e, c)}
            className={`heat-${level(c.seconds)} cell-in aspect-square rounded-[3px] outline outline-1 -outline-offset-1 outline-transparent transition-[outline-color] duration-150 hover:outline-[var(--text)]`}
            style={{ ["--i" as string]: col, ["--r" as string]: row }}
          />
        );
      })}
    </>
  );
}
