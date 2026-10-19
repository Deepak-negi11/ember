"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check, Code, Sparkle } from "@phosphor-icons/react";

export interface BoardOption {
  key: "coding" | "ai";
  label: string;
  description: string;
  href: string;
}

const ICONS = { coding: Code, ai: Sparkle };

/** The leaderboard's board picker: a heading-sized button that opens a two-item menu. */
export function BoardMenu({ current, options }: { current: BoardOption["key"]; options: BoardOption[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const active = options.find((o) => o.key === current)!;
  const Icon = ICONS[active.key];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus the current choice so arrow keys and Enter work straight away.
    root.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[data-board-item]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }

  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="group -ml-2 flex items-center gap-2.5 rounded-2xl px-2 py-1 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text sm:size-11">
          <Icon size={22} weight="duotone" aria-hidden />
        </span>
        <span className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{active.label}</span>
        <CaretDown
          size={20}
          weight="bold"
          aria-hidden
          className={`mt-1 shrink-0 text-muted transition-transform duration-200 group-hover:text-text ${open ? "rotate-180" : ""}`}
        />
        <span className="sr-only">, switch board</span>
      </button>

      {open && (
        <div
          id={menuId}
          onKeyDown={onMenuKey}
          className="menu-in absolute left-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface p-1.5 shadow-card"
        >
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Leaderboards</p>
          <ul>
            {options.map((o) => {
              const ItemIcon = ICONS[o.key];
              const selected = o.key === current;
              return (
                <li key={o.key}>
                  <Link
                    href={o.href}
                    data-board-item
                    aria-current={selected ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${selected ? "bg-surface-2/60" : ""}`}
                  >
                    <ItemIcon aria-hidden size={18} weight={selected ? "fill" : "regular"} className={`mt-0.5 shrink-0 ${selected ? "text-accent-text" : "text-muted"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{o.label}</span>
                      <span className="block text-sm text-muted">{o.description}</span>
                    </span>
                    {selected && <Check aria-hidden size={16} weight="bold" className="mt-1 shrink-0 text-accent-text" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
