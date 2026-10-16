/** Shared layout for the privacy policy and terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
      <h1 className="rise font-display text-4xl font-medium tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-muted">Last updated {updated}</p>
      <div
        className="rise mt-10 grid gap-8 leading-relaxed text-muted [&_a]:font-medium [&_a]:text-accent-text [&_a:hover]:underline [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight [&_h2]:text-text [&_li]:mt-2 [&_strong]:text-text [&_ul]:list-disc [&_ul]:pl-5"
        style={{ ["--d" as string]: 1 }}
      >
        {children}
      </div>
    </article>
  );
}
