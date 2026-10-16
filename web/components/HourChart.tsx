"use client";

import { useRef, useState } from "react";
import { useInView } from "motion/react";

const label = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);

/**
 * Share of the week's activity by local hour of day. One hue (magnitude), heat
 * steps by intensity, 2px gaps, rounded tops on the baseline. Hovering a column
 * swaps the readout above the chart; the peak hour is shown by default.
 */
export function HourChart({ hours }: { hours: number[] }) {
  const total = hours.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(max);
  const [active, setActive] = useState<number | null>(null);
  const chart = useRef<HTMLDivElement>(null);
  const inView = useInView(chart, { once: true, amount: 0.4 });
  const shown = active ?? peak;
  const pct = (h: number) => ((hours[h] / total) * 100).toFixed(1);

  return (
    <div>
      <p className="h-6 text-sm text-muted" aria-live="polite">
        <span className="font-semibold text-text">{label(shown)}</span>
        {" · "}
        {pct(shown)}% of this week&apos;s activity{active === null && " (busiest hour)"}
      </p>
      <div
        ref={chart}
        data-in={inView ? "true" : "false"}
        className="mt-4 flex h-40 items-end gap-[2px] sm:h-48"
        onMouseLeave={() => setActive(null)}
        role="img"
        aria-label={`Activity by hour of day. Busiest at ${label(peak)} with ${pct(peak)}% of the week's activity.`}
      >
        {hours.map((v, h) => {
          const lvl = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
          return (
            <div key={h} className="flex h-full flex-1 items-end" onMouseEnter={() => setActive(h)}>
              {/* Outer bar grows on reveal; inner dims on hover, so the two transitions never fight. */}
              <div className="bar-grow w-full origin-bottom" style={{ height: `${Math.max(3, (v / max) * 100)}%`, ["--b" as string]: h }}>
                <div
                  className={`heat-${Math.max(lvl, 1)} h-full w-full rounded-t-[4px] transition-opacity duration-200 ${
                    active !== null && active !== h ? "opacity-45" : ""
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint" aria-hidden>
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>11 PM</span>
      </div>
    </div>
  );
}
