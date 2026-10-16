# Ember - Coding Time Tracker

Tracks your coding time and sends it to your Ember server. It works without
changes in **VS Code, Cursor, Windsurf and VSCodium**. The editor is detected
automatically.

## Setup

1. Install the `.vsix`: open the Extensions view, then `...` > *Install from VSIX...*.
2. Run **Ember: Set API Key** from the Command Palette and paste the key from your dashboard.
   The key goes into the editor's SecretStorage and is also written to
   `~/.ember/config.json` (mode 0600). The Claude Code / Codex hook reads that
   file too, so you only set the key once.
3. If your server is not at `http://localhost:3000`, set **`ember.apiUrl`** in your
   user settings. If you leave it unset, `api_url` from `~/.ember/config.json` is used.

The status bar shows a flame icon with today's total (e.g. `2h 14m`). Click it to open the
dashboard. The tooltip shows the last sync result.

## Commands

| Command | What it does |
| --- | --- |
| `Ember: Set API Key` | Validate and store the key (SecretStorage + `~/.ember/config.json`) |
| `Ember: Open Dashboard` | Open `<apiUrl>/dashboard` |
| `Ember: Show Status` | Editor, server, key source, queue size, last sync. Includes a *Sync Now* button |

## What is sent

A heartbeat goes out when you switch files, when you keep working in the same
file for 2 minutes or more, or when you save (`is_write: true`). It contains the
time, the project (git root folder name), the branch, the language, the editor,
the detected tech stack (e.g. `Next.js, React, Tailwind CSS, TypeScript`) and
`sha1(absolute file path)`. File contents and file paths are never sent. Only
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
