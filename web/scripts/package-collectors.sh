#!/usr/bin/env bash
# Build the editor extension and bundle the agent hook into public/downloads,
# so the website can serve real installable files.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/public/downloads"
mkdir -p "$OUT"

echo "Building VS Code / Cursor extension..."
( cd "$ROOT/extensions/vscode" && npm install --silent && npm run build --silent && npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o "$OUT/ember-vscode.vsix" >/dev/null )

echo "Bundling Claude Code / Codex hook..."
COPYFILE_DISABLE=1 tar -czf "$OUT/ember-agent-hook.tgz" -C "$ROOT/collectors/agent-hook" \
  --exclude test --exclude node_modules --exclude '*.log' .

ls -lh "$OUT"
