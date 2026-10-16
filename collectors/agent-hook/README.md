# Ember agent hook (Claude Code + Codex CLI)

`ember-hook.mjs` turns AI coding-agent activity into Ember heartbeats
(`category: "ai"`, `editor: "claude-code"` or `"codex"`). It has no
dependencies and needs Node 18 or newer.

What gets sent: the time, the project name (basename of the git root, or the
working directory), the git branch, the language guessed from the touched file's
extension, `sha1(absolute file path)`, `is_write` for edit tools, and the
detected tech stack. Prompt text, tool output, file contents and raw paths are
never sent.

## 1. API key

Create a key in the Ember dashboard, then either:

```sh
node install.mjs --key ember_<40 hex chars> [--api-url https://your-ember-host]
```

or set it once in VS Code (`Ember: Set API Key`). Both write the shared
`~/.ember/config.json` (`{"api_key": "...", "api_url": "..."}`, mode 0600).

## 2a. Claude Code: installer

```sh
node install.mjs claude            # merges hooks into ~/.claude/settings.json
node install.mjs claude --uninstall
```

Hooks are added for `SessionStart`, `UserPromptSubmit`, `PostToolUse` and `Stop`.
The installer backs up the file first (`settings.json.bak-<timestamp>`), is
idempotent, and only adds or removes entries whose command references
`ember-hook.mjs`. It uses absolute paths to this script and to the current
`node` binary, so do not move this folder after installing. If you do move it,
run the installer again.

## 2b. Claude Code: plugin

This folder is also a Claude Code plugin (`.claude-plugin/plugin.json` +
`hooks/hooks.json`). The hooks run `node "${CLAUDE_PLUGIN_ROOT}/ember-hook.mjs" --agent claude-code`,
so `node` must be on the `PATH`. To try it locally:

```sh
claude --plugin-dir /path/to/ember/collectors/agent-hook
```

Use either the plugin or the installer, not both. Using both records every event twice.

## 3. Codex CLI

```sh
node install.mjs codex             # merges hooks into ~/.codex/hooks.json ($CODEX_HOME respected)
node install.mjs codex --uninstall
```

Hooks are added for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`
and `SessionEnd`. Codex does not run hooks that your organisation doesn't
manage until you review and trust them. Start Codex, open `/hooks` and trust the
Ember entries. Depending on your Codex version, hooks may also need to be
enabled in its config. Check the Codex documentation for your version.

## Manual configuration

Claude Code (`~/.claude/settings.json`) or Codex (`~/.codex/hooks.json`) use the
same shape. Change `--agent` to `codex` for Codex and add a `SessionEnd`
entry there:

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node \"/abs/path/ember-hook.mjs\" --agent claude-code" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"/abs/path/ember-hook.mjs\" --agent claude-code" }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "node \"/abs/path/ember-hook.mjs\" --agent claude-code" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"/abs/path/ember-hook.mjs\" --agent claude-code" }] }]
  }
}
```

## How it behaves

- **Always exits 0, prints nothing to stdout.** It reads stdin for at most 1s
  and exits on its own after 9s at most. Errors go to `~/.ember/hook.log`,
  which rotates at 1 MB.
- **Durable queue.** Each heartbeat is appended to `~/.ember/queue.jsonl`
  first, then the whole queue is flushed in batches of 500 with a 2.5s timeout
  per request. `queue.lock` (stale after 10s) guards every queue mutation.
  Only one hook sends at a time: a claimed batch lives in
  `queue.inflight.jsonl` until it is acknowledged. The queue is capped at
  20,000 lines and the oldest are dropped first.
- **Server responses.** `202` removes the batch from the queue. `400` drops it
  without a retry. `401` writes `~/.ember/last_error` and keeps the queue.
  `429`, `5xx` and network errors keep the queue and back off from 30s up to
  10 minutes (stored in `~/.ember/hook-state.json`).
- **Throttle.** A `PostToolUse` event is skipped when the same agent and project
  sent a heartbeat less than 30s earlier. Session and prompt events are always
  recorded.
- **Overrides.** `EMBER_HOME` (default `~/.ember`), `EMBER_API_URL`, `EMBER_API_KEY`.

## Tests

```sh
npm test    # node --test; uses temp HOME/EMBER_HOME dirs and a local HTTP server
```
