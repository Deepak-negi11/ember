import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { currentUser } from "@/lib/auth.ts";
import { Avatar, Logo, btn } from "@/components/ui.tsx";
import { NavLinks } from "@/components/NavLinks.tsx";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Ember: coding time, in heat", template: "%s · Ember" },
  description: "Coding time tracking for VS Code, Cursor, Claude Code and Codex, with a yearly heatmap and leaderboard.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Applies a stored theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("ember-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const links = [{ href: "/leaderboard", label: "Leaderboard" }, ...(user ? [{ href: "/dashboard", label: "Dashboard" }, { href: "/settings", label: "Settings" }] : [])];

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <a href="#main" className="sr-only rounded-full bg-ink px-4 py-2 text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-24 focus:z-30">
          Skip to content
        </a>

        <header className="fixed inset-x-0 top-0 z-20 px-3 pt-3 sm:px-4 sm:pt-4">
          <nav className="mx-auto flex h-16 max-w-6xl min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface/75 pl-4 pr-2 shadow-card backdrop-blur-xl sm:pl-5">
            <Logo />
            <div className="ml-4 hidden items-center gap-0.5 md:flex">
              <NavLinks links={links} />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              {user ? (
                <>
                  <Link href="/leaderboard" className="rounded-full px-2.5 py-2 text-sm font-medium text-muted hover:text-text max-[400px]:hidden md:hidden">
                    Ranks
                  </Link>
                  <Link href="/dashboard" className="rounded-full px-2.5 py-2 text-sm font-medium text-muted hover:text-text max-[340px]:hidden md:hidden">
                    Stats
                  </Link>
                  <Link href={`/u/${user.username}`} aria-label="Your public profile" className="rounded-full p-1 transition hover:opacity-85">
                    <Avatar name={user.display_name} src={user.avatar_url} size={40} />
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login" className={btn.small}>
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>

        <div className="relative flex min-h-[100dvh] flex-col">
          <div className="atmosphere" aria-hidden />
          <main id="main" className="relative flex-1 pt-24 sm:pt-28">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
              <div>
                <Logo />
                <p className="mt-2 text-sm text-muted">Tracks time, never file contents or prompts.</p>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
                <Link href="/leaderboard" className="hover:text-text">Leaderboard</Link>
                <Link href="/#community" className="hover:text-text">This week</Link>
                <Link href="/#setup" className="hover:text-text">Setup</Link>
                <Link href="/privacy" className="hover:text-text">Privacy</Link>
                <Link href="/terms" className="hover:text-text">Terms</Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
