import { headers } from "next/headers";

/** The public base URL of this server, for commands users copy into a terminal. */
export async function publicOrigin(): Promise<string> {
  if (process.env.EMBER_URL) return process.env.EMBER_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
