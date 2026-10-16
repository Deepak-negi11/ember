# Publishing Ember

Goal: anyone can run one command and every editor and agent on their machine is connected.

```bash
npx embertime setup --key ember_...
```

That command installs the extension from the stores (`ember-dev.ember`) and the
Claude Code / Codex hooks. For that to work, four things must be public. Each
needs an account that only you can create.

## 0. Deploy the server first (required)

Extensions and hooks send data to `api_url`. Today that is `http://localhost:3000`,
which only exists on your laptop. Deploy `web/` somewhere with HTTPS and a
**persistent disk** (SQLite lives in `web/data/`):

- Fly.io, Railway or Render with a volume mounted at `web/data`, or any VPS.
- Serverless hosts (Vercel, Netlify) will lose the SQLite file. Use them only
  after moving the database to Postgres/Turso.
- Set `EMBER_URL=https://your-domain`, the X and Google OAuth secrets, and use
  `https://your-domain/api/auth/callback/x` (and `/google`) as callback URLs.
- Do **not** set `EMBER_DEV_LOGIN` in production.

The clients point at **https://ember-dev.vercel.app**. If the domain ever changes,
update these 6 places, then bump versions and republish the extension and npm package:

- `extensions/vscode/src/config.ts`: `DEFAULT_API_URL`
- `extensions/vscode/package.json`: `ember.apiUrl` default
- `collectors/agent-hook/cli.mjs`: `DEFAULT_API_URL`
- `collectors/agent-hook/ember-hook.mjs`: `DEFAULT_API_URL`
- `collectors/agent-hook/install.mjs`: fallback `api_url` in `writeEmberConfig`
- `web/components/SetupTabs.tsx`: `DEFAULT_API`

Also update `EMBER_URL` on Vercel and the callback URLs in the GitHub, Google
and X sign-in apps (`<domain>/api/auth/callback/<github|google|x>`).

## 1. Put the code on GitHub

Done: the repo is https://github.com/Deepak-negi11/ember and both
`package.json` files link to it.

## 2. VS Code Marketplace (VS Code users)

1. Create the publisher `ember-dev` at https://marketplace.visualstudio.com/manage
   (Microsoft account). If the id is taken, pick another and update `publisher`.
2. Authenticate `vsce`. Microsoft now recommends Microsoft Entra ID
   (`vsce publish --azure-credential`); Azure DevOps global PATs (scope
   *Marketplace > Manage*, *All accessible organizations*) are retired on
   December 1, 2026.
3. Publish:
   ```bash
   cd extensions/vscode && npm run publish:vscode
   ```

## 3. Open VSX (Cursor, Windsurf, VSCodium)

These editors install from Open VSX, not the Microsoft Marketplace, so publish
there too.

1. Sign in at https://open-vsx.org with GitHub, sign the publisher agreement,
   and create an access token.
2. Create the namespace once, then publish:
   ```bash
   npx ovsx create-namespace ember-dev -p <token>
   cd extensions/vscode && OVSX_PAT=<token> npm run publish:openvsx
   ```

## 4. npm (the one command)

`ember` and `ember-cli` belong to Ember.js, so the package is `embertime`
(free when checked).

```bash
cd collectors/agent-hook
npm login
npm publish
```

## 5. That's it for users

The website's setup section already shows the WakaTime-style install:
`npm install -g embertime` (or `bun add -g` / `pnpm add -g`), then
`embertime setup --key ...`, or "search Ember in the Extensions view".
These work as soon as steps 2-4 are published.

## Releasing updates

- Extension: bump `version`, then `npm run publish:vscode && npm run publish:openvsx`.
  Installed copies update automatically.
- npm package: bump `version`, `npm publish`. Users re-run `npx embertime setup`.
