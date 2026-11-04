# Contributing to dsh-mcp-center

Thanks for taking a look. This is a small DeepSeek Harness plugin: two JavaScript files, a
JSON catalog, a demo MCP server and a set of plain-`node` test suites. There is no build
step, no bundler and **no dependencies at all** — that is a feature, not an accident, so a
pull request that adds a runtime dependency needs a very good reason.

Bug reports and ideas are welcome at <https://github.com/AidenX0704/dsh-mcp/issues>.
Security issues go through [SECURITY.md](SECURITY.md) instead — never a public issue.

## Requirements

- **Node.js >= 22** (this is the same floor as `engines.node` in `package.json`; the demo
  server, the probe and the test suites all run on plain Node).
- Git, and optionally a running DeepSeek Harness (`>=0.2.0-rc`) for manual QA and the live
  end-to-end suite.
- Nothing else. `npx`, `uvx` and `docker` only matter if you want to *use* specific
  marketplace servers; they are never needed to develop or test this plugin.

## Setup

```bash
git clone https://github.com/AidenX0704/dsh-mcp.git
cd dsh-mcp
npm test
```

Do **not** run `npm install` — there is nothing to install and no lockfile to honor. Clone
and run the tests; that is the whole setup.

## Running the tests

| Command | What it runs | Notes |
|---|---|---|
| `npm test` | `node test/run.mjs` | The offline suite: Host half, Client half, demo server self-test and the MCP stdio probe, then a per-suite summary. |
| `npm run test:host` | `node test/host-harness.mjs` | Host half (`index.js`) against a mock Cordis context: state, generated bundles, import parsing, scope, invocation mode, `/mcp`, restart persistence, loopback authorization, error branches. |
| `npm run test:client` | `node test/client-smoke.mjs` | Client half (`client.js`) rendered through a React stub: sidebar registration, the three tabs, server cards in each state, the invoke console, the four drawers (manual / import / quick add / edit). |
| `npm run test:demo` | `node demo/demo-server.mjs --selftest` | The zero-dependency demo MCP server's own protocol checks. |
| `node test/run.mjs --e2e` | everything above plus the live suite | Convenience wrapper for the live suite below. |
| `npm run test:e2e` (alias `npm run e2e`) | `node test/e2e-http.mjs` | Live suite only; needs a running Harness (see below). |

The probe can also be run on its own against any stdio server:

```bash
node test/mcp-probe.mjs -- node demo/demo-server.mjs
```

### The live end-to-end suite is opt-in

`test/e2e-http.mjs` talks to a **running** Harness Web UI and therefore never runs in
`npm test`. Point it at your instance:

```bash
DSH_WEB_URL=http://127.0.0.1:6922 node test/e2e-http.mjs
```

(`npm run test:e2e` runs the same script, but you still need `DSH_WEB_URL` set.)

In PowerShell:

```powershell
$env:DSH_WEB_URL = "http://127.0.0.1:6922"; node test/e2e-http.mjs
```

With `DSH_WEB_URL` unset the script falls back to `http://127.0.0.1:3637`. It creates a
demo server, discovers its tools, calls a couple of them, changes scope and invocation
mode, disables and re-enables the server, and deletes it again — so run it against a
profile you don't mind poking.

## Manual QA in a running Harness

For anything visible in the UI, run the plugin from your checkout:

1. Build nothing. Install the checkout itself: call the `plugin_manager` tool with
   `action: install_bundle` and `target` set to the **absolute path of your clone**
   (for example `C:\Users\you\dsh-mcp`). An absolute path is installed as a `link:`
   dependency, so Harness keeps reading your working tree and no reinstall is needed
   after you edit `index.js` or `client.js`.
2. Enable the bundle for the profile you are testing (Plugins page or `plugin_manager`).
3. **Reload the Web UI (F5).** The Client half is loaded when the page boots, so a
   changed `client.js` only appears after a page reload; Host-side changes appear on the
   row's own reload/HMR.
4. Open **MCP** in the sidebar (order 40, below Plugins, Automations and Skills), or run
   `/mcp` in a conversation to check the command path, or just ask the model to use the
   `mcp_manager` tool.

Uninstall with `plugin_manager` `remove_bundle` when you are done, and remember a `link:`
install breaks if you delete or move the clone.

## Code map

| Path | Role |
|---|---|
| `index.js` | Host half: durable server registry, generated per-server bundles installed through the profile Plugin Manager, scope + invocation mode enforcement via tool restrictions, loopback HTTP API, the `mcp_manager` tool, the `/mcp` command, and the scope-guarded MCP resource tools. |
| `client.js` | Client half: the sidebar entry and the main-column page (Configured / Marketplace / Invoke tabs, plus the create / edit / import / quick-add drawers). |
| `data/marketplace.json` | The curated catalog rendered in the Marketplace tab. |
| `data/MARKETPLACE-SPEC.md` | The data contract for that catalog — read it before touching a single entry. |
| `demo/demo-server.mjs` | Zero-dependency MCP stdio server used by the demo entry and every test; supports `--selftest`. |
| `test/host-harness.mjs` | Offline Host suite (mock Cordis context). |
| `test/client-smoke.mjs` | Offline Client suite (React stub). |
| `test/mcp-probe.mjs` | Dependency-free MCP stdio probe (handshake, `tools/list`, `tools/call`). |
| `test/e2e-http.mjs` | Optional live suite against a running Harness. |
| `test/run.mjs` | `npm test` entry point: runs the four offline suites and prints a summary. |
| `locale/*.json` | Plugin-page title/description, `en` and `zh`. |
| `cordis.patch.yml` | Inserts the Host row. |
| `dsh.plugin.json` | Community plugin manifest. Its `version` is kept in sync by `scripts/sync-version.mjs` during `npm version` — don't hand-edit it. |

## Style

The existing code is the specification; these are the rules it actually follows:

- **ESM only.** `package.json` has `"type": "module"`; `index.js`, the tests and the demo
  server use `import`. `client.js` is the Client-half bundle format
  (`window.__ModuleLoader__.load({ factory(require) { … } })`) and gets React from the
  module table.
- **2-space indent, no tabs, LF, trailing newline, no trailing whitespace.**
- **No semicolons** in application code and single quotes for strings. Keep it that way so
  diffs stay readable.
- **JSDoc on anything non-obvious**: a `@param` per argument and `@returns` with the shape
  spelled out (`{kind: 'all'|'workspace'|'session', …}`), not just "object". File headers
  explain *why* the module is shaped that way.
- **Client half rules.** Styling uses Host theme tokens only
  (`var(--dsw-alias-bg-base)`, `var(--dsw-alias-label-primary)`,
  `var(--dsw-alias-border-l1)`, …) — no hard-coded colors, so light and dark both work.
  Never import a Harness Client package from `client.js`; go through
  `require(...)` from the injected module table and through this package's own loopback
  API.
- **No new dependencies.** `index.js`, `client.js`, `demo/demo-server.mjs` and every test
  must run from a bare Node install. Native Node APIs only.
- **Secrets never leave the Host unmasked.** Anything that returns server entries to the
  Client or to the model goes through the existing masking path; `env:NAME` references must
  stay references.
- **Keep both locales in sync.** A new user-visible string needs an `en` and a `zh` entry,
  and new catalog text needs both fields too.

## Sending a pull request

- Keep PRs **small and focused**: one behaviour change, one fix or one catalog batch. Large
  mixed PRs are hard to review and slow to land.
- **Behaviour changes need tests.** Add or extend a suite under `test/` and make sure
  `npm test` passes; for UI work, say which tab/drawer you exercised in a running Harness.
- **Commit subjects**: conventional-ish and imperative — `feat: add docker requirement
  badge`, `fix: keep scope when renaming a server`, `docs: …`, `chore: …`, `test: …`.
  English and Chinese are both fine.
- Mention **breaking changes** explicitly in the PR description (state layout, generated
  bundle shape, command syntax, tool schema). `state.json` compatibility matters: users
  have live entries in it.
- Never commit secrets, `state.json` copies, tokens in test fixtures, screenshots with
  keys in them, or scratch material.
- Fill in the pull request template — it asks for what/why, what you tested, and a
  breaking-change note.

## Adding a marketplace entry

The Marketplace tab is a curated list of real servers, not a directory dump.

1. Read [`data/MARKETPLACE-SPEC.md`](data/MARKETPLACE-SPEC.md) in full; it defines every
   field, the requirement kinds and the accuracy rules.
2. Copy the `command`, `args`, `url`, `env` and `headers` **from the vendor's current
   documentation or README** — never from memory, never invented, never a package you
   assume exists.
3. Include a real source URL (`docs` and `homepage`) so a reader can verify the entry.
4. If a package was renamed or archived, list the maintained one and mention the old one in
   `notes`. Don't resell a deprecated package as current.
5. Fill `title`, `summary` and `notes` in **both** `zh` and `en`, set truthful
   `requirements`, and set `verifiedAt` to the date you actually confirmed the entry —
   never a date you did not check.
6. Open an issue with the **Marketplace entry** template first if you are unsure, then the
   PR. Run `npm test` before pushing; the catalog is loaded by the Host at startup, and a
   malformed entry breaks the tab.

## Reporting security issues

Please don't open a public issue for a vulnerability. Use GitHub Security Advisories as
described in [SECURITY.md](SECURITY.md); it also documents the plugin's threat model, so
you can tell quickly whether something is a real finding or a documented non-goal.
