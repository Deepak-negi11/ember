import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { currentUser } from "@/lib/auth.ts";
import { Avatar, Logo, btn } from "@/components/ui.tsx";
import { NavLinks } from "@/components/NavLinks.tsx";
import { ProfileMenu } from "@/components/ProfileMenu.tsx";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";
import { GitHubStar } from "@/components/GitHubStar.tsx";
import { Analytics } from "@vercel/analytics/next";
import { AUTHOR, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site.ts";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  category: "developer tools",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, url: "/", title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
  // Google Search Console: paste the "HTML tag" verification code into GOOGLE_SITE_VERIFICATION on Vercel.
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
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
  // Signed-out visitors get no page links: the landing page links to the setup guide itself.
  const links = user
    ? [
        { href: "/leaderboard", label: "Leaderboard" },
        { href: "/dashboard", label: "Dashboard" },
        { href: "/settings", label: "Settings" },
        { href: "/setup", label: "Setup" },
      ]
    : [];

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
              <span className={user ? "max-md:hidden" : "max-[360px]:hidden"}>
                <GitHubStar />
              </span>
              {user ? (
                <>
                  <Link href="/leaderboard" className="rounded-full px-2.5 py-2 text-sm font-medium text-muted hover:text-text max-[400px]:hidden md:hidden">
                    Ranks
                  </Link>
                  <Link href="/dashboard" className="rounded-full px-2.5 py-2 text-sm font-medium text-muted hover:text-text max-[340px]:hidden md:hidden">
                    Stats
                  </Link>
                  <ProfileMenu
                    name={user.display_name}
                    username={user.username}
                    avatar={<Avatar name={user.display_name} src={user.avatar_url} size={40} />}
                  />
                </>
              ) : (
                <Link href="/login" className={btn.small}>
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </header>

        <div className="relative flex min-h-[100dvh] flex-col">
          <div className="atmosphere" aria-hidden />
          <main id="main" className="relative flex-1 pt-24 sm:pt-28">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 sm:grid-cols-[1fr_auto_1fr] sm:items-end sm:px-6">
              <div>
                <Logo />
                <p className="mt-2 text-sm text-muted">Tracks time, never file contents or prompts.</p>
              </div>
              <p className="text-sm text-muted max-sm:order-last sm:text-center">
                Developed with{" "}
                <span role="img" aria-label="love" className="text-[13px]">❤️</span>{" "}
                by <span className="font-medium text-text">{AUTHOR.name}</span>
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted sm:justify-end">
                <Link href="/privacy" className="hover:text-text">Privacy</Link>
                <Link href="/terms" className="hover:text-text">Terms</Link>
              </div>
            </div>
          </footer>
        </div>
        <Analytics />
      </body>
    </html>
  );
}
