"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChartBar, Gear, SignOut, User } from "@phosphor-icons/react";
import { logout } from "@/app/actions.ts";

/**
 * Avatar button in the nav that opens the account menu (profile, dashboard,
 * settings, sign out). Closes on outside click, Escape, or choosing an item.
 */
export function ProfileMenu({ name, username, avatar }: { name: string; username: string; avatar: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();

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
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-text transition-colors hover:bg-surface-2";

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="rounded-full p-1 transition-[opacity,transform] hover:opacity-85 active:scale-95"
      >
        {avatar}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full z-30 mt-2 w-60 origin-top-right rounded-2xl border border-line bg-surface p-1.5 shadow-card"
          >
            <div className="border-b border-line px-3 pb-2.5 pt-2">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-muted">@{username}</p>
            </div>
            <div className="py-1.5" onClick={() => setOpen(false)}>
              <Link href={`/u/${username}`} role="menuitem" className={item}>
                <User size={16} className="text-muted" /> Your profile
              </Link>
              <Link href="/dashboard" role="menuitem" className={item}>
                <ChartBar size={16} className="text-muted" /> Dashboard
              </Link>
              <Link href="/settings" role="menuitem" className={item}>
                <Gear size={16} className="text-muted" /> Settings
              </Link>
            </div>
            <form action={logout} className="border-t border-line pt-1.5">
              <button type="submit" role="menuitem" className={item}>
                <SignOut size={16} className="text-muted" /> Sign out
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
