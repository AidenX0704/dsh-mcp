# Releasing

A maintainer checklist. The plugin has **zero runtime dependencies and no build step**, so a release is a source tag: nothing is compiled, nothing is bundled, and the artifact you publish is the tree you tested.

- [Pre-flight](#pre-flight)
- [1. Bump the version](#1-bump-the-version)
- [2. Write the changelog entry](#2-write-the-changelog-entry)
- [3. Run the offline suite](#3-run-the-offline-suite)
- [4. Commit and tag](#4-commit-and-tag)
- [5. Publish the GitHub Release](#5-publish-the-github-release)
- [6. What a release note must contain](#6-what-a-release-note-must-contain)
- [7. How consumers get the release](#7-how-consumers-get-the-release)
- [Optional: publish to npm](#optional-publish-to-npm)
- [Things that must not drift](#things-that-must-not-drift)

## Pre-flight

| Check | Why |
|---|---|
| Node `>=22` locally | the same floor `engines.node` declares; the suite is written for it |
| a clean working tree | `npm version` commits and tags; a dirty tree makes the tag ambiguous |
| `CHANGELOG.md` has an `Unreleased` section with the entries for this version | writing it after tagging is how entries get lost |
| `engines.dsh` still matches what you tested | `>=0.2.0-rc`; if you start using a newer Host API, this is the moment to raise it |
| `data/marketplace.json` entries still resolve | `npx -y <pkg>` must install today, `url` endpoints must speak Streamable HTTP; bump each `verifiedAt` only for entries you actually re-checked |

## 1. Bump the version

```bash
npm version patch     # or: minor / major, or an explicit 0.1.1
```

`npm version` runs the `version` script from `package.json`:

```json
"version": "node scripts/sync-version.mjs && git add dsh.plugin.json"
```

so `dsh.plugin.json` (the plugin-manager manifest) is rewritten to match `package.json` and staged in the same commit. `index.js` reads `version` from the installed `package.json` at load time, so there is exactly one place a release number has to be edited; the script exists only to keep the second file honest.

`npm version` also creates the commit and the tag `v<version>`. If you prefer to write the tag yourself, use exactly `vX.Y.Z` — that is the form the README's install snippets and the release notes use.

## 2. Write the changelog entry

Move the pending entries under a new heading, newest first. The file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), so the heading carries the version in brackets and the release date, and the bottom of the file keeps the compare links:

```markdown
## [0.1.1] - 2026-11-12

### Added

- `/mcp test <server> <tool> <json>` prints the tool call result as JSON.

### Fixed

- Scope changes no longer require a reinstall when only `workspaceIds` change.

### Changed

- Marketplace: `context7` `verifiedAt` refreshed against the vendor docs.
```

```markdown
[Unreleased]: https://github.com/AidenX0704/dsh-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/AidenX0704/dsh-mcp/releases/tag/v0.1.1
```

Rules that keep the file useful:

- One bullet per user-visible change. "Refactor" with no behaviour change belongs in the commit message, not here.
- Say what a user must do (reinstall? remove + install? nothing?) when the answer is not "nothing".
- Note any `state.json` shape change explicitly — that is the one thing an update can make awkward to undo.

## 3. Run the offline suite

```bash
npm test
```

Four independent `node` processes, no network, no running Harness:

| Suite | Covers |
|---|---|
| `test/host-harness.mjs` | Host half against a mock Cordis context: state machine, YAML generation, import parsing, scope, guard, commands, restart persistence, loopback authorization, error branches |
| `test/client-smoke.mjs` | Client half rendered with a React stub: slot registration, three tabs, every server-card state, market cards, invoke console, four dialogs, theme tokens only |
| `demo/demo-server.mjs --selftest` | the demo MCP server's protocol checks (33 assertions) |
| `test/mcp-probe.mjs` | a real stdio handshake against that demo server: `initialize`, `tools/list`, `tools/call` |

`node test/run.mjs --e2e` (or `DSH_WEB_URL=http://127.0.0.1:<port> node test/e2e-http.mjs`) is the live suite: it creates a demo server in the running profile, exercises scope and mode changes, then removes it. Run it before a release if you touched anything in `index.js` that talks to the Plugin Manager, and **not** against a profile you care about.

A red suite blocks the release. `npm pack` runs the same suite through the `prepack` hook, so packaging will refuse too.

## 4. Commit and tag

If `npm version` already did it:

```bash
git push --follow-tags
```

Otherwise:

```bash
git add -A
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin main --tags
```

Check that the tag points at the commit you tested:

```bash
git show --stat v0.1.1
```

## 5. Publish the GitHub Release

1. Build the tarball from the tagged tree:

   ```bash
   npm pack            # dsh-mcp-center-ui-0.2.0.tgz
   ```

2. Create the release on GitHub for tag `v0.1.1`, titled `v0.1.1`.
3. Attach `dsh-mcp-center-ui-0.2.0.tgz` as an asset — it is what people install on machines without git or a registry.
4. Mark a `0.x` release as a **pre-release** only if you genuinely expect churn; otherwise leave it a normal release so its notes are the default.

The release body is the changelog entry for that version (see below), not a link to the changelog — people read the release page, not your repository.

## 6. What a release note must contain

| Element | Example |
|---|---|
| Version and date | `v0.1.1 — 2026-11-12` |
| One-line summary | "Manual invocation console, plus a fix for workspace scope." |
| Changes, grouped | `Added` / `Changed` / `Fixed` / `Removed`, same text as `CHANGELOG.md` |
| Install / update commands | the exact `plugin_manager` JSON, and the tag spec |
| Upgrade notes | anything that needs a restart, a re-add of a server, or a state change |
| Compatibility | the DSH and Node floors this version was tested against |
| Asset | the `.tgz` attached to the release |

Do **not** claim CI results, download counts, or platforms you did not run. If the live end-to-end suite was not run, say so.

## 7. How consumers get the release

Consumers install by tag, so the release is immediately consumable without publishing anything:

```
https://github.com/AidenX0704/dsh-mcp#v0.1.1
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#v0.1.1"}
```

An update is remove + install — DSH reports `already-installed` for an install over an existing package, so the release note should spell out both steps:

```json
{"action":"remove_bundle","target":"dsh-mcp-center-ui"}
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#v0.1.1"}
```

Expect `restart-required` on the update path: replacing an installed package needs a fresh module generation. Remind readers to press F5 afterwards for the Client half. Rollback is the same pair of calls with an older tag — see [update.md](update.md).

## Optional: publish to npm

The package is published as **`dsh-mcp-center-ui`**. The bare `dsh-mcp-center` name on npm was
already taken by an unrelated settings-only MCP manager, so this package keeps the `-ui` suffix;
`publishConfig.registry` points at the public registry so a mirror configured in `.npmrc` cannot
swallow the publish:

```bash
npm login                       # once per machine
npm publish                     # uses publishConfig.registry + access: public
npm view dsh-mcp-center-ui version
```

Before doing it for the first time, check that the published file list is what you expect:

```bash
npm pack --dry-run
```

Expected contents: `index.js`, `client.js`, `cordis.patch.yml`, `dsh.plugin.json`, `icon.svg`, `data/marketplace.json`, `data/MARKETPLACE-SPEC.md`, `demo/demo-server.mjs`, `locale/en.json`, `locale/zh.json`, `docs/*.md`, `README.md`, `README.zh.md`, `CHANGELOG.md`, `LICENSE`. The tests are deliberately not shipped.

Publishing changes nothing about how the plugin works; it just adds a second install spec (`dsh-mcp-center-ui@^0.2.0`) next to the git tag. The runtime identity — plugin id `dsh-external/dsh-mcp-center`, module id `dsh-mcp-center`, route `/api/dsh-mcp-center`, state dir `$DSH_HOME/mcp-center`, generated bundles `@dsh-mcp-center/server-<id>` — deliberately keeps the short name, so a rename of the distribution never migrates an existing install.

## Things that must not drift

| Artifact | Kept true by |
|---|---|
| `package.json` `version` | `npm version` (single source of truth; `index.js` reads it) |
| `dsh.plugin.json` | `scripts/sync-version.mjs` via the `version` script |
| `CHANGELOG.md` | the release checklist above |
| `README.md` / `README.zh.md` install snippets | update the tag example whenever the current release changes |
| `docs/` pages that quote behaviour | the same commit that changes the behaviour |
| `data/marketplace.json` `verifiedAt` | only re-check by hand — never copy a date you did not verify |
| `engines.node` / `engines.dsh` | raise deliberately, with a note in the changelog |

Generated per-server bundles (`@dsh-mcp-center/server-<id>`, version `0.1.<revision>`) are runtime artifacts under `$DSH_HOME`, not release outputs — never try to version or publish them.
