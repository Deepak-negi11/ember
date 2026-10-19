"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInView } from "motion/react";

export interface HeatCell { date: string; seconds: number; ai_seconds: number }
type GridCell = HeatCell & { future: boolean };

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

// Dates are calendar days in the profile owner's zone, stored as UTC midnight: format in UTC.
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function describe(c: HeatCell) {
  const when = dayFormat.format(toDate(c.date));
  return { value: c.seconds ? fmt(c.seconds) : "No coding", when };
}

/** Space kept between the tooltip and the cell, and between the tooltip and the screen edge. */
const GAP = 8;
const EDGE = 8;

/**
 * Hover/focus tooltip rendered into <body> with fixed positioning, so neither the
 * scrolling grid nor the card can clip it. It sits above the cell when there is
 * room and below it otherwise, and is clamped inside the viewport horizontally.
 */
function Tooltip({ anchor, clip, cell, id }: { anchor: HTMLElement; clip: HTMLElement; cell: HeatCell; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; below: boolean; hidden: boolean } | null>(null);

  // Follow the cell while the page or the grid scrolls; hide it once the cell scrolls out of the grid.
  useLayoutEffect(() => {
    const place = () => {
      const tip = ref.current;
      if (!tip) return;
      const a = anchor.getBoundingClientRect();
      const box = clip.getBoundingClientRect();
      const { width, height } = tip.getBoundingClientRect();
      const center = a.left + a.width / 2;
      const left = Math.min(Math.max(center - width / 2, EDGE), window.innerWidth - width - EDGE);
      const below = a.top - height - GAP < EDGE;
      const top = below ? a.bottom + GAP : a.top - height - GAP;
      const hidden = center < box.left || center > box.right;
      setPos({ left, top, arrow: Math.min(Math.max(center - left, 12), width - 12), below, hidden });
    };
    place();
    window.addEventListener("scroll", place, { passive: true, capture: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [anchor, clip, cell]);

  const { value, when } = describe(cell);
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="tip-in pointer-events-none fixed z-50 max-w-[calc(100vw-16px)] rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-card"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos && !pos.hidden ? "visible" : "hidden" }}
    >
      <div className="flex items-center gap-2">
        <span className={`heat-${level(cell.seconds)} inline-block size-2.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-[var(--line-strong)]`} />
        <span className="num text-[13px] font-semibold text-text">{value}</span>
      </div>
      <div className="mt-0.5 whitespace-nowrap text-muted">{when}</div>
      {pos && (
        <span
          aria-hidden
          className={`absolute size-2 rotate-45 border-line-strong bg-surface ${pos.below ? "-top-[5px] border-l border-t" : "-bottom-[5px] border-b border-r"}`}
          style={{ left: pos.arrow - 4 }}
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * GitHub-style year grid: 53 week columns, Sunday on top. `end` is "today" in
 * the profile owner's time zone so the last column is always the current week.
 * Hover or tap a day for details; with the grid focused, arrow keys move by day/week.
 */
export function Heatmap({ cells, end, compact = false }: { cells: HeatCell[]; end: string; compact?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Start the cell wave only once the grid is actually on screen.
  const inView = useInView(scroller, { once: true, amount: 0.35 });
  const [active, setActive] = useState<{ col: number; row: number; el: HTMLElement } | null>(null);
  const [fadeLeft, setFadeLeft] = useState(false);
  const tipId = useId();

  const { weeks, months } = useMemo(() => {
    const byDate = new Map(cells.map((c) => [c.date, c]));
    const endD = toDate(end);
    const start = new Date(endD);
    start.setUTCDate(start.getUTCDate() - 364 - start.getUTCDay());

    const weeks: GridCell[][] = [];
    const months: { col: number; label: string }[] = [];
    const cursor = new Date(start);
    for (let w = 0; cursor <= endD; w++) {
      const week: GridCell[] = [];
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

  // On touch screens a tap shows a day; a tap anywhere else hides it again.
  useEffect(() => {
    if (!active) return;
    const outside = (e: PointerEvent) => {
      if (!scroller.current?.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [active]);

  // Cells are fluid: they grow to fill the container, and below `size` the
  // grid stops shrinking and scrolls horizontally instead.
  const size = compact ? 10 : 11;
  const gap = 3;

  const cellEl = (col: number, row: number) => scroller.current?.querySelector<HTMLElement>(`[data-cell="${col}-${row}"]`) ?? null;

  function activate(col: number, row: number) {
    const el = cellEl(col, row);
    if (el && !weeks[col]?.[row]?.future) setActive({ col, row, el });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (e.key === "Escape") return setActive(null);
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const from = active ?? lastDay();
    let col = from.col + m[0];
    let row = from.row + m[1];
    // Up/down wrap between weeks so every day is reachable.
    if (row < 0) [col, row] = [col - 1, 6];
    if (row > 6) [col, row] = [col + 1, 0];
    if (col < 0 || col >= weeks.length || weeks[col][row].future) return;
    cellEl(col, row)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    activate(col, row);
  }

  function lastDay() {
    const col = weeks.length - 1;
    const row = weeks[col].findLastIndex((c) => !c.future);
    return { col, row };
  }

  const totalDays = cells.filter((c) => c.seconds > 0).length;
  const activeCell = active ? weeks[active.col][active.row] : null;

  return (
    <div>
      <div
        ref={scroller}
        data-in={inView ? "true" : "false"}
        tabIndex={0}
        role="group"
        aria-roledescription="activity calendar"
        aria-label={`Coding activity, last 12 months: ${totalDays} active days. Use arrow keys to read each day.`}
        aria-describedby={activeCell ? tipId : undefined}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          // Keyboard focus starts on today; a click already picked its own day.
          if (e.target === e.currentTarget && !active && e.currentTarget.matches(":focus-visible")) {
            const { col, row } = lastDay();
            activate(col, row);
          }
        }}
        onBlur={() => setActive(null)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onScroll={(e) => setFadeLeft(e.currentTarget.scrollLeft > 4)}
        className={`relative -mx-1 overflow-x-auto rounded-lg px-1 pb-2 pt-1 [scrollbar-width:thin] focus-visible:outline-offset-4 ${
          fadeLeft ? "[mask-image:linear-gradient(to_right,transparent,#000_28px)]" : ""
        }`}
      >
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `28px repeat(${weeks.length}, minmax(${size}px, 1fr))`, columnGap: gap, rowGap: gap, maxWidth: 28 + weeks.length * 21 }}
        >
          {/* Month labels */}
          <div />
          <div className="relative mb-1 h-4" style={{ gridColumn: `2 / span ${weeks.length}` }} aria-hidden>
            {months.map((m) => (
              <span key={`${m.label}-${m.col}`} className="absolute top-0 text-[11px] font-medium leading-4 text-faint" style={{ left: `${(m.col / weeks.length) * 100}%` }}>
                {m.label}
              </span>
            ))}
          </div>

          {/* Weekday labels + cells, row by row */}
          {Array.from({ length: 7 }, (_, row) => (
            <Row key={row} row={row} weeks={weeks} today={end} active={active} onEnter={activate} />
          ))}
        </div>
      </div>

      {active && activeCell && scroller.current && <Tooltip anchor={active.el} clip={scroller.current} cell={activeCell} id={tipId} />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="text-pretty">Time spent writing code. Breaks under 15 minutes count; longer ones don&apos;t.</span>
        <span className="flex items-center gap-1.5" aria-label="Legend: from no activity to more than 4 hours">
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
  row, weeks, today, active, onEnter,
}: {
  row: number;
  weeks: GridCell[][];
  today: string;
  active: { col: number; row: number } | null;
  onEnter: (col: number, row: number) => void;
}) {
  return (
    <>
      <span className="flex items-center pr-1 text-[11px] leading-none text-faint" aria-hidden>
        {row % 2 === 1 ? WEEKDAYS[row] : ""}
      </span>
      {weeks.map((week, col) => {
        const c = week[row];
        if (c.future) return <span key={c.date} className="aspect-square" />;
        const isActive = active?.col === col && active.row === row;
        return (
          <div
            key={c.date}
            aria-hidden
            data-cell={`${col}-${row}`}
            onPointerEnter={(e) => e.pointerType === "mouse" && onEnter(col, row)}
            onPointerDown={() => onEnter(col, row)}
            className={`heat-${level(c.seconds)} cell-in aspect-square rounded-[3px] outline outline-1 -outline-offset-1 transition-[outline-color] duration-150 hover:outline-[var(--text)] ${
              isActive ? "outline-[var(--text)]" : c.date === today ? "outline-[var(--accent)]" : "outline-transparent"
            }`}
            style={{ ["--i" as string]: col, ["--r" as string]: row }}
          />
        );
      })}
    </>
  );
}
