"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

function fmt(value: number, as: "duration" | "int") {
  if (as === "int") return Math.round(value).toLocaleString("en-US");
  const m = Math.floor(value / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Counts a number up when it scrolls into view. Writes to the DOM directly so
 *  the animation never re-renders React. */
export function CountUp({ value, as = "duration", className }: { value: number; as?: "duration" | "int"; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) {
      el.textContent = fmt(value, as);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => (el.textContent = fmt(v, as)),
    });
    return () => controls.stop();
  }, [inView, value, as, reduce]);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {fmt(value, as)}
    </span>
  );
}
