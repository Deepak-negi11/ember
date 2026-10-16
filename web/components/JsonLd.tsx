/**
 * Structured data for search engines. `<` is escaped so user-written fields
 * (names, bios) can never close the script tag and inject markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
