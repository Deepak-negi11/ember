"use client";

import { Moon, Sun } from "@phosphor-icons/react";

/** Flips between light and dark, remembered per browser. The inline script in
 *  the root layout applies the stored choice before first paint. */
export function ThemeToggle() {
  function toggle() {
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
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="grid size-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-text active:scale-95"
    >
      <Sun size={18} className="show-dark" />
      <Moon size={18} className="show-light" />
    </button>
  );
}
