import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="num font-display text-7xl font-medium text-accent">404</p>
      <h1 className="mt-4 font-display text-3xl font-medium tracking-tight">Nothing burning here</h1>
      <p className="mt-2 text-muted">That page or profile does not exist.</p>
      <Link href="/leaderboard" className="mt-6 inline-block font-medium text-accent-text hover:underline">Browse the leaderboard</Link>
    </div>
  );
}
