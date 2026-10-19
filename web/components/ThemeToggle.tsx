"use client";

import { Moon, Sun } from "@phosphor-icons/react";

/** Flips between light and dark, remembered per browser. The inline script in
 *  the root layout applies the stored choice before first paint. */
export function ThemeToggle() {
  function apply() {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("ember-theme", next);
    } catch {
      /* storage blocked: the choice simply won't persist */
    }
  }

  // The new theme spreads out as a circle from the button. Browsers without view
  // transitions, and people who prefer reduced motion, get an instant switch.
  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    const box = e.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 550, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="grid size-9 place-items-center rounded-full text-muted transition-[background-color,color,transform] hover:bg-surface-2 hover:text-text active:scale-95"
    >
      <Sun size={18} className="show-dark theme-icon" aria-hidden />
      <Moon size={18} className="show-light theme-icon" aria-hidden />
    </button>
  );
}
