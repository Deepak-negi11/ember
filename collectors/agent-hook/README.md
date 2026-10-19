# embertime

Track your coding time in **VS Code, Cursor, Windsurf, Claude Code, Codex and
Cursor Agent** with one command. Your time shows up on
[Ember](https://ember-dev.vercel.app) as a yearly heatmap, language stats and a
developer leaderboard.

Ember records **when** and **in which project** you write code. Only writing counts:
an editor or agent that is just open adds no time. It never sends your
code, file contents, file paths or AI prompts.

## Setup

1. Sign in at [ember-dev.vercel.app](https://ember-dev.vercel.app) with GitHub or
   Google, then open **Settings → Create API key**.
2. Install the CLI:

   ```bash
   npm install -g embertime
   ```

   or `bun add -g embertime` / `pnpm add -g embertime`.
3. Connect everything:

   ```bash
   embertime setup --key ember_YOUR_KEY
   ```

That's it. `setup` finds what's installed on your machine and connects each one:

| Tool | What setup does |
|---|---|
| VS Code, Cursor, Windsurf, VSCodium | Installs the Ember extension |
| Claude Code | Adds hooks to `~/.claude/settings.json` (backed up first) |
| Codex | Adds hooks to `~/.codex/hooks.json`. Then run `/hooks` in Codex once to trust them |
| Cursor Agent | Adds hooks to `~/.cursor/hooks.json` |

Running it again is safe: it only adds what's missing.

Prefer not to install globally? `npx embertime setup --key ember_YOUR_KEY` does the same.

## Commands

```bash
embertime setup --key ember_...   # connect every editor and agent found
embertime status                  # what's connected, today's time, queued activity
embertime uninstall               # remove hooks and the extension
embertime uninstall --purge       # ...and delete local data in ~/.ember
```

Options for `setup`: `--api-url <url>` for a self-hosted Ember server,
`--vsix <file>` to install the extension from a local file, `--skip-editors` to
only set up the AI agents.

## Reliability and privacy

- Activity is queued in `~/.ember/queue.jsonl` while you're offline and sent
  when you're back. Nothing is lost.
- Hooks always exit immediately and print nothing to Claude Code or Codex, so
  they can never slow down or confuse your agent.
- Your key is stored in `~/.ember/config.json`, readable only by you (mode 0600).
- What is sent: timestamp, project name, language, git branch, editor or agent,
  whether a file was saved, and the detected tech stack. A one-way hash of the
  file path is used only to avoid double counting.
- Token usage (Claude Code and Codex): at the end of each turn the hook reads
  the agent's own session log on your machine (and, when a Claude Code subagent
  finishes, that subagent's log) and sends only the model name and
  four token counts (input, output, cache read, cache write). Prompts, replies,
  code and paths in that log are never sent. Turn it off with
  `"send_usage": false` in `~/.ember/config.json` or `EMBER_SEND_USAGE=0`.

Requires Node.js 18 or newer. MIT licensed.
