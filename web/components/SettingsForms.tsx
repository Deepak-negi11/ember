"use client";

import { useActionState, useState } from "react";
import { Key, Terminal } from "@phosphor-icons/react";
import { regenerateKey, updateProfile, type FormState } from "@/app/actions.ts";
import { CopyButton, Field, FormMessage, inputCls, Submit } from "./forms.tsx";

type Profile = {
  display_name: string; bio: string; quote: string; twitter: string; github: string;
  website: string; location: string; timezone: string; hide_projects: number;
};

export function ProfileForm({ user, zones, xHandle, githubHandle }: { user: Profile; zones: string[]; xHandle: string | null; githubHandle: string | null }) {
  const [state, action] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Display name" name="display_name" defaultValue={user.display_name} required maxLength={50} />
        <Field label="Location" name="location" defaultValue={user.location} maxLength={60} placeholder="Dehradun, India…" />
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Bio</span>
        <textarea name="bio" defaultValue={user.bio} maxLength={200} rows={2} className={inputCls} />
        <span className="text-xs text-muted">Up to 200 characters.</span>
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Your quote</span>
        <input name="quote" defaultValue={user.quote} maxLength={100} className={inputCls} placeholder="The line people read when you top the board…" />
        <span className="text-xs text-muted">One line, up to 100 characters. Shown on your profile, and with your name at the top of the leaderboard when you hold #1.</span>
      </label>
      <div className="grid items-start gap-5 sm:grid-cols-3">
        {xHandle ? (
          <div className="grid gap-2">
            <span className="text-sm font-medium">X / Twitter</span>
            <span className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[15px]">@{xHandle}</span>
            <span className="text-xs text-muted">Verified through your connected X account.</span>
          </div>
        ) : (
          <Field label="X / Twitter" name="twitter" defaultValue={user.twitter} placeholder="your_handle…" maxLength={40} spellCheck={false} autoComplete="off" hint="Connect X above to verify it." />
        )}
        {githubHandle ? (
          <div className="grid gap-2">
            <span className="text-sm font-medium">GitHub</span>
            <span className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[15px]">{githubHandle}</span>
            <span className="text-xs text-muted">Verified through your GitHub sign-in.</span>
          </div>
        ) : (
          <Field label="GitHub" name="github" defaultValue={user.github} placeholder="your-username…" maxLength={60} spellCheck={false} autoComplete="off" />
        )}
        <Field label="Website" name="website" type="url" defaultValue={user.website} placeholder="https://example.com…" maxLength={200} autoComplete="url" />
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Time zone</span>
        <select name="timezone" defaultValue={user.timezone} className={inputCls}>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <span className="text-xs text-muted">Decides where your days start and end. Applies to new activity.</span>
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-line p-4">
        <input type="checkbox" name="hide_projects" defaultChecked={!!user.hide_projects} className="mt-1 size-4 accent-[var(--accent)]" />
        <span>
          <span className="block text-sm font-medium">Hide project names on my public profile</span>
          <span className="block text-sm text-muted">Totals, languages and the heatmap stay visible.</span>
        </span>
      </label>
      <FormMessage state={state} />
      <div><Submit>Save profile</Submit></div>
    </form>
  );
}

export function ApiKeyPanel({ hint, lastUsed }: { hint: string | null; lastUsed: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(regenerateKey, undefined);
  // Remember whether a key existed before this visit, to explain that it was replaced.
  const [hadKey] = useState(Boolean(hint));
  const key = state?.key;
  const command = key ? `embertime setup --key ${key}` : "";
  return (
    <div className="grid gap-4">
      {key ? (
        <div className="rise grid gap-4 rounded-2xl border border-line-strong bg-surface-2 p-4">
          <div className="flex items-start gap-2 text-sm">
            <Key size={16} className="mt-0.5 shrink-0 text-muted" />
            <span>
              <span className="font-medium">Your new key.</span>{" "}
              <span className="text-muted">
                Copy it now; for security it&apos;s only shown once.{hadKey ? " Your previous key no longer works." : ""}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code className="num min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-3 py-2 text-sm">{key}</code>
            <CopyButton text={key} />
          </div>
          <div className="grid gap-2 border-t border-line pt-4">
            <p className="flex items-center gap-2 text-sm text-muted">
              <Terminal size={16} className="shrink-0" />
              {hadKey ? "Run this once to switch every editor and agent to the new key:" : "Run this once to connect every editor and agent:"}
            </p>
            <div className="flex items-center gap-2">
              <code className="num min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-3 py-2 text-sm">{command}</code>
              <CopyButton text={command} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-4">
          <Key size={18} className="text-muted" />
          <div className="text-sm">
            {hint ? (
              <>
                <span className="num">ember_••••••••••••{hint}</span>
                <span className="block text-muted">{lastUsed ? `Last used ${lastUsed}` : "Not used yet"}</span>
              </>
            ) : (
              <span className="text-muted">No key yet. Create one to connect your editor.</span>
            )}
          </div>
        </div>
      )}
      <form action={action} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Submit>{hint ? "Regenerate key" : "Create API key"}</Submit>
        {hint && !key && <p className="text-sm text-muted">Regenerating replaces your current key right away.</p>}
      </form>
    </div>
  );
}
