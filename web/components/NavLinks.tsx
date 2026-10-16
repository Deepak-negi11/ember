"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Nav links with a filled pill on the current page. */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              active ? "bg-surface-2 text-text" : "text-muted hover:text-text"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
