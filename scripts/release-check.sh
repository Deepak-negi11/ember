#!/usr/bin/env bash
# Check what would ship, and what already ships, before a release.
#
#   1. Pack the agent hook and run the privacy test against the packed file.
#   2. Package the extension and check the .vsix holds only the expected files.
#   3. Download what npm and Open VSX serve. Same version but different files
#      means the version was not bumped (or a stale build was published): fail.
#   4. REA report of what changed in shipped code since the published release.
#
# Runs the same locally and in CI (.github/workflows/release-check.yml).
# Needs: node, npm, git, curl, unzip, network. SKIP_REA=1 skips step 4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ember-release-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAILED=0
step() { printf '\n== %s\n' "$*"; }
fail() { printf '::error::%s\n' "$*"; FAILED=1; }
version() { node -p "require('$1/package.json').version"; }

HOOK="$ROOT/collectors/agent-hook"
EXT="$ROOT/extensions/vscode"
HOOK_VER="$(version "$HOOK")"
EXT_VER="$(version "$EXT")"

step "Pack the agent hook (embertime $HOOK_VER)"
(cd "$HOOK" && npm pack --silent --pack-destination "$WORK" >/dev/null)
mkdir -p "$WORK/hook-new"
tar -xzf "$WORK/embertime-$HOOK_VER.tgz" -C "$WORK/hook-new"
grep -q "VERSION = '$HOOK_VER'" "$WORK/hook-new/package/ember-hook.mjs" \
  || fail "ember-hook.mjs VERSION does not match package.json ($HOOK_VER)"

step "Privacy test against the packed hook"
(cd "$HOOK" && EMBER_HOOK_UNDER_TEST="$WORK/hook-new/package/ember-hook.mjs" node --test test/privacy.test.mjs) \
  || fail "privacy test failed against the packed hook"

step "Package the extension (embertime $EXT_VER)"
(cd "$EXT" && npx --yes @vscode/vsce@4.0.0 package --no-dependencies -o "$WORK/embertime-$EXT_VER.vsix" >/dev/null)
mkdir -p "$WORK/ext-new"
unzip -q "$WORK/embertime-$EXT_VER.vsix" -d "$WORK/ext-new"
expected=$'[Content_Types].xml\nextension.vsixmanifest\nextension/LICENSE.txt\nextension/changelog.md\nextension/dist/extension.js\nextension/icon.png\nextension/package.json\nextension/readme.md'
actual="$(cd "$WORK/ext-new" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)"
if [ "$actual" != "$expected" ]; then
  fail "unexpected files in the .vsix (source, tests or maps leaking?)"
  diff <(echo "$expected") <(echo "$actual") || true
fi
grep -q "const VERSION = '$EXT_VER';" "$EXT/src/extension.ts" \
  || fail "src/extension.ts VERSION does not match package.json ($EXT_VER)"

step "Compare with what npm serves"
PUB_HOOK="$(npm view embertime version)"
mkdir -p "$WORK/pub" "$WORK/hook-pub"
(cd "$WORK/pub" && npm pack "embertime@$PUB_HOOK" --silent >/dev/null)
tar -xzf "$WORK/pub/embertime-$PUB_HOOK.tgz" -C "$WORK/hook-pub"
if [ "$PUB_HOOK" = "$HOOK_VER" ]; then
  diff -r "$WORK/hook-pub/package" "$WORK/hook-new/package" >/dev/null \
    && echo "npm embertime@$PUB_HOOK matches this tree." \
    || fail "npm embertime@$HOOK_VER differs from this tree: bump collectors/agent-hook's version before releasing"
else
  echo "npm has $PUB_HOOK; this tree is $HOOK_VER (unreleased changes)."
fi

step "Compare with what Open VSX serves"
OVSX_JSON="$(curl -fsS https://open-vsx.org/api/ember-dev/embertime)"
PUB_EXT="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$OVSX_JSON")"
curl -fsSL -o "$WORK/pub/ext.vsix" "$(node -e 'console.log(JSON.parse(process.argv[1]).files.download)' "$OVSX_JSON")"
mkdir -p "$WORK/ext-pub"
unzip -q "$WORK/pub/ext.vsix" -d "$WORK/ext-pub"
if [ "$PUB_EXT" = "$EXT_VER" ]; then
  diff -r "$WORK/ext-pub/extension" "$WORK/ext-new/extension" >/dev/null \
    && echo "Open VSX $PUB_EXT matches this tree." \
    || fail "Open VSX $EXT_VER differs from this tree: bump extensions/vscode's version before releasing"
else
  echo "Open VSX has $PUB_EXT; this tree is $EXT_VER (unreleased changes)."
fi

if [ "${SKIP_REA:-0}" != "1" ]; then
  step "REA: what changed in shipped code"
  node "$ROOT/scripts/release-diff.mjs" "Agent hook: npm $PUB_HOOK -> $HOOK_VER" "$WORK/hook-pub/package" "$WORK/hook-new/package"
  node "$ROOT/scripts/release-diff.mjs" "Extension: Open VSX $PUB_EXT -> $EXT_VER" "$WORK/ext-pub/extension" "$WORK/ext-new/extension"
fi

if [ "$FAILED" = 1 ]; then
  printf '\nRelease check FAILED.\n'
  exit 1
fi
printf '\nRelease check passed.\n'
