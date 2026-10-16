"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy } from "@phosphor-icons/react";
import type { FormState } from "@/app/actions.ts";
import { btn } from "./styles.ts";

export const inputCls =
  // The ring starts transparent at 0px so focus fades and grows in instead of snapping on.
  "w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-[15px] text-text placeholder:text-faint outline-none ring-0 ring-transparent transition-[border-color,box-shadow] duration-300 ease-out focus:border-accent/60 focus:ring-4 focus:ring-accent/15";

export function Field({ label, name, hint, ...rest }: { label: string; name: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid content-start gap-2">
      <span className="text-sm font-medium">{label}</span>
      <input name={name} className={inputCls} {...rest} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={btn.primary}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state?.error) return <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p role="status" className="text-sm font-medium text-accent-text">{state.ok}</p>;
  return null;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked; the text is still selectable */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs transition hover:bg-surface-2 active:scale-95"
      aria-label={done ? "Copied" : label}
    >
      {done ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
      {done ? "Copied" : label}
    </button>
  );
}
