"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, destroySession, generateApiKey } from "@/lib/auth.ts";
import { linkedAccounts } from "@/lib/accounts.ts";
import { run } from "@/lib/db.ts";
import { isValidTimeZone } from "@/lib/time.ts";
import { forgetTimeZones } from "@/lib/stats.ts";

export type FormState = { error?: string; ok?: string; key?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function logout() {
  await destroySession();
  redirect("/");
}

function cleanHandle(v: string) {
  return v.replace(/^https?:\/\/(www\.)?(twitter|x|github)\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
}

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const display = str(form, "display_name");
  const bio = str(form, "bio");
  const quote = str(form, "quote");
  // A connected X account is the source of truth for the handle.
  const accounts = await linkedAccounts(user.id);
  const xLinked = accounts.find((a) => a.provider === "x");
  const ghLinked = accounts.find((a) => a.provider === "github");
  const twitter = xLinked ? xLinked.handle : cleanHandle(str(form, "twitter"));
  const github = ghLinked ? ghLinked.handle : cleanHandle(str(form, "github"));
  const website = str(form, "website");
  const location = str(form, "location");
  const tz = str(form, "timezone");

  if (!display || display.length > 50) return { error: "Display name must be 1-50 characters." };
  if (bio.length > 200) return { error: "Bio must be 200 characters or fewer." };
  if (quote.length > 100) return { error: "Keep your quote to one line: 100 characters or fewer." };
  if (twitter && !/^[A-Za-z0-9_]{1,15}$/.test(twitter)) return { error: "That X / Twitter handle is not valid." };
  if (github && !/^[A-Za-z0-9-]{1,39}$/.test(github)) return { error: "That GitHub username is not valid." };
  if (website && !/^https:\/\/[^\s]{3,200}$/.test(website)) return { error: "Website must start with https://" };
  if (location.length > 60) return { error: "Location must be 60 characters or fewer." };
  if (!isValidTimeZone(tz)) return { error: "Pick a valid time zone." };

  await run(
    `UPDATE users SET display_name = ?, bio = ?, quote = ?, twitter = ?, github = ?, website = ?,
            location = ?, timezone = ?, hide_projects = ? WHERE id = ?`,
    display, bio, quote, twitter, github, website, location, tz, form.get("hide_projects") ? 1 : 0, user.id,
  );
  forgetTimeZones();

  revalidatePath("/", "layout");
  return { ok: "Profile saved." };
}

export async function regenerateKey(_: FormState): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const key = await generateApiKey(user.id);
  revalidatePath("/settings");
  return { key };
}
