# Ember

Coding-time tracking for VS Code, Cursor, Claude Code and Codex. Collectors send
small "heartbeats" to a server, which turns them into a GitHub-style year heatmap,
per-language / per-project / per-editor breakdowns, a detected tech stack, public
profiles, and a weekly leaderboard whose #1 gets their quote featured.

```
ember/
  web/                     Next.js 16 app + API (SQLite via node:sqlite, no native deps)
  extensions/vscode/       Extension for VS Code, Cursor, Windsurf, VSCodium
  collectors/agent-hook/   Hook script + installer for Claude Code and Codex
```

## Run it locally

Requires Node 22.13+ (tested on 24).

```bash
cd web && npm install && npm run seed && npm run dev
```

Sign-in is **X or Google only** (no passwords). Copy `web/.env.example` to
`web/.env.local` and fill in the client id/secret for each provider:

- **X:** developer.x.com → your app → User authentication settings → OAuth 2.0,
  type *Web App*, callback `http://localhost:3000/api/auth/callback/x`.
- **Google:** console.cloud.google.com → Credentials → OAuth client ID (Web),
  redirect URI `http://localhost:3000/api/auth/callback/google`.

Use the port you actually run on in those callback URLs. Without credentials you
can still try the app locally: `EMBER_DEV_LOGIN=1` adds a "sign in as" picker to
`/login` (never available in production builds).

Open http://localhost:3000, sign in, then **Settings → Create API key**.
`npm run seed` adds 10 fictional demo users with a year of generated activity
(they can't be signed into). Skip it for a clean install. The database lives in
`web/data/ember.db`; delete that file to reset.

## Connect your tools

The website serves real installers: run `npm run collectors` in `web/` once to
build `public/downloads/ember-vscode.vsix` and `ember-agent-hook.tgz`. The
landing page and Settings then show **Download** buttons and copy-paste commands
that contain this server's actual address.

One key covers everything. It is stored in `~/.ember/config.json` (mode 0600).

**VS Code / Cursor / Windsurf**

```bash
(cd extensions/vscode && npm install && npm run package)
code --install-extension extensions/vscode/embertime-0.1.0.vsix
cursor --install-extension extensions/vscode/embertime-0.1.0.vsix
```

Then run **Ember: Set API Key** from the command palette. If your server is not on
`http://localhost:3000`, set `ember.apiUrl` in your user settings.

**Claude Code** (writes a backup of `~/.claude/settings.json` first)

```bash
node collectors/agent-hook/install.mjs claude --key YOUR_KEY
```

**Codex** (then open Codex, run `/hooks` and trust the Ember entries)

```bash
node collectors/agent-hook/install.mjs codex --key YOUR_KEY
```

Both installers take `--uninstall`. See `collectors/agent-hook/README.md` for the
Claude Code plugin option and manual JSON.

## Try it on your own machine before publishing

Until `embertime` is on npm and the extension is on the Marketplace / Open VSX,
the public commands (`npm install -g embertime`, "search embertime in Extensions")
return 404. Install both from this repo instead:

```bash
npm install -g ./collectors/agent-hook        # the embertime CLI, from this folder
(cd extensions/vscode && npm run package)     # builds embertime-0.1.0.vsix
embertime setup --key ember_YOUR_KEY --vsix ./extensions/vscode/embertime-0.1.0.vsix
```

After publishing (see PUBLISHING.md) nobody needs these: users run
`npm install -g embertime` and `embertime setup --key ...`, as the /setup page shows.

## How time is counted

- Only writing code counts. Editors send a heartbeat when you type in a file (at most
  once every 2 minutes per file) or save it; agents send one when they change a file
  (Write, Edit, MultiEdit, apply_patch, Cursor's file edits). Opening an editor,
  switching files, starting an agent session, prompting or reading files adds no time,
  and the server ignores any non-writing heartbeat from older collectors.
- All heartbeats for a day are merged into **one timeline**. Each gap between two
  consecutive heartbeats is credited to the earlier one, if it is under 15 minutes.
  Merging first means Cursor and Claude Code running at the same time are never
  double counted.
- Agent heartbeats are tagged `ai`, so the UI shows hands-on vs AI-agent time.
- Daily rollups are rebuilt from raw heartbeats for every day a batch touches.
  Re-sending a batch is a no-op (unique constraint), so client retries are safe.
- Heatmap colours use fixed thresholds (<30m, <2h, <4h, 4h+), so the same colour
  means the same thing on every profile.

## Reliability

- Collectors queue locally (VS Code `globalState`, `~/.ember/queue.jsonl` for
  hooks), retry with exponential backoff, and drop only on 400 (invalid data).
- The agent hook always exits 0 within a few seconds and prints nothing, so it can never
  block or confuse Claude Code / Codex.
- Server ingest is transactional; invalid items in a batch are rejected
  individually.

## Privacy

Sent: project name, language, branch, editor, timestamps, detected stack, and a
SHA-1 of the file path (for de-duplication). Never sent: code, prompts, tool
output, raw file paths. Users can hide project names on their public profile.

## Security notes

- API keys are stored as SHA-256 hashes and shown once on creation.
- Sign-in uses OAuth 2.0 authorization code + PKCE (S256) with a random state
  checked in constant time. Accounts are never merged by email; a second
  provider is linked only while signed in (Settings → Connected accounts).
- Connecting X makes the profile's X handle verified (read-only).
- Sessions are random tokens (hashed in the DB) in httpOnly SameSite=Lax
  cookies. Server actions check request origin.
- Sign-in and ingest are rate limited (in-memory, per process).

## Tests

```bash
(cd web && npm test)                        # durations, streaks, parsing, ingest
(cd extensions/vscode && npm test)          # stack detection, queue, heartbeat rule
(cd collectors/agent-hook && npm test)      # payloads, queue/locking, installer
```

## Known limitations

- The leaderboard cuts off on UTC calendar days, so its edges can differ by a few
  hours from a user's local day.
- The rate limiter is per process; use a shared store (e.g. Redis) if you run
  several server instances.
- Leaderboard time includes AI-agent time. An agent left running scores points, so
  a public deployment may want an "editor only" board or a daily cap.
- SQLite fits a single server. Move to Postgres before horizontal scaling.
