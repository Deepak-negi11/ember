# Ember - Coding Time Tracker

Tracks your coding time in **VS Code, Cursor, Windsurf and VSCodium** and turns
it into a yearly heatmap, language and project stats, and a developer
leaderboard on [Ember](https://ember-dev.vercel.app). Your code, file contents
and file paths are never sent.

## Setup

1. Sign in at [ember-dev.vercel.app](https://ember-dev.vercel.app) with GitHub or
   Google and create an API key in **Settings**.
2. Connect the key, one of two ways:
   - **Everything at once (recommended):** run
     `npm install -g embertime` and then `embertime setup --key ember_...`.
     This also connects Claude Code, Codex and Cursor Agent, and the
     extension picks the key up automatically.
   - **Just this editor:** run **Ember: Set API Key** from the Command Palette
     and paste the key.
3. Restart the editor and start coding. Your time shows up in the status bar
   and on your dashboard within a couple of minutes.

The key is stored in the editor's SecretStorage and in `~/.ember/config.json`
(readable only by you), so every editor and agent on the machine shares it.
Self-hosting? Set **`ember.apiUrl`** in your user settings.

The status bar shows a flame icon with today's total (e.g. `2h 14m`). Click it to open the
dashboard. The tooltip shows the last sync result.

## Commands

| Command | What it does |
| --- | --- |
| `Ember: Set API Key` | Validate and store the key (SecretStorage + `~/.ember/config.json`) |
| `Ember: Open Dashboard` | Open `<apiUrl>/dashboard` |
| `Ember: Show Status` | Editor, server, key source, queue size, last sync. Includes a *Sync Now* button |

## What is sent

Only writing code counts. A heartbeat goes out when you type in a file (at most
once every 2 minutes per file) or save it. Opening, switching between or
scrolling through files sends nothing, so an editor left open adds no time. It contains the
time, the project (git root folder name), the branch, the language, the editor,
the detected tech stack (e.g. `Next.js, React, Tailwind CSS, TypeScript`) and
a hash of the absolute file path, keyed with a random secret stored only on your
machine (`~/.ember/entity.key`). File contents and file paths are never sent. Only
`file:` documents are tracked. Output panels, untitled buffers and diff views
are ignored.

Heartbeats are batched every 30 seconds. If the server can't be reached they are
stored in the extension's global state (up to 5,000) and retried with backoff
from 30s up to 10 minutes. If the key is rejected (401), sending pauses until
you set a new key.

## Development

```sh
npm install
npm run build     # esbuild -> dist/extension.js
npm run watch
npm test          # node:test unit tests (stack detection, git, queue, config)
npm run package   # builds ember-<version>.vsix via @vscode/vsce
```
