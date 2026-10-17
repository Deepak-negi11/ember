# Changelog

## 0.1.3

- New setting `ember.sendBranch`: turn it off to keep branch names on your machine. `send_branch: false` in `~/.ember/config.json` does the same for every Ember collector.

## 0.1.2

- File paths are now hashed with a random key that stays on your machine (`~/.ember/entity.key`), so a guessed path can't be matched to a stored hash.

## 0.1.1

- Only writing code counts: typing and saving. Opening, switching or scrolling through files no longer adds time.
- Clearer setup instructions on the Marketplace page.

## 0.1.0

- First release.
- Tracks time per project, language, branch and editor in VS Code, Cursor, Windsurf and VSCodium.
- Detects the project's tech stack from manifests (package.json, Cargo.toml, pyproject.toml, go.mod and more).
- Offline queue with retry, so no activity is lost when the server is unreachable.
- Status bar shows today's time. Commands: Set API Key, Open Dashboard, Show Status.
