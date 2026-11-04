## What

<!-- What changed, and in which half: Host (index.js), Client (client.js), catalog (data/), demo server, tests, docs. -->

## Why

<!-- The problem this solves. Link the issue if there is one: "Fixes #123". -->

## Testing done

- [ ] `npm test` passes locally (Host, Client, demo self-test, MCP probe)
- [ ] `npm run test:host` (if the Host half changed)
- [ ] `npm run test:client` (if the Client half changed)
- [ ] `npm run test:demo` (if the demo server changed)
- [ ] Manual QA in a running Harness: `plugin_manager` `install_bundle` with this checkout's path → reload the UI (F5) → exercised the affected tab / `/mcp` subcommand / `mcp_manager` action
- [ ] Live suite (optional): `DSH_WEB_URL=http://127.0.0.1:6922 node test/e2e-http.mjs`

<!-- Say what you actually checked and what you could not check. "Not verified in a browser" is fine. -->

## Docs

- [ ] No docs change needed
- [ ] Updated `README.md` / `README.zh.md` / `docs/` (another teammate owns those files — mention it here instead of editing if they are in flight)
- [ ] Updated `data/MARKETPLACE-SPEC.md` (catalog contract changed)

## Breaking change

<!-- None, or: what breaks for existing users. state.json compatibility, generated bundle
shape, /mcp syntax, mcp_manager tool schema, catalog field meanings. -->

None.

## Checklist

- [ ] Tests added or extended for the behaviour change (not just for a typo fix)
- [ ] No secrets in the diff: no tokens, no `state.json` copies, no API keys in fixtures or screenshots
- [ ] Catalog entries (if any) verified against the vendor's current docs, with a truthful `verifiedAt`, both `zh` and `en` text, and a real source URL
- [ ] New user-visible strings exist in both locales
- [ ] No new runtime dependencies (`index.js` / `client.js` / demo / tests stay dependency-free)
- [ ] `dsh.plugin.json` version untouched by hand (`npm version` runs `scripts/sync-version.mjs`)
