# Updating, pinning and rolling back

The package has no runtime dependencies and no build step, so a release is nothing more than a source tag. Updating is therefore cheap — but DSH does not have an "upgrade in place" operation, and pretending otherwise is how people end up with a half-installed plugin. This page describes what actually happens.

- [Version policy](#version-policy)
- [How a running version is reported](#how-a-running-version-is-reported)
- [The update flow for git installs](#the-update-flow-for-git-installs)
- [Moving between `link:` and a tagged release](#moving-between-link-and-a-tagged-release)
- [Verifying what is running](#verifying-what-is-running)
- [Rolling back](#rolling-back)
- [What an update does not touch](#what-an-update-does-not-touch)

## Version policy

| Item | Rule |
|---|---|
| `version` in `package.json` | single source of truth; `index.js` reads it at load time and reports it as the plugin version |
| `CHANGELOG.md` | human-readable record; every release adds an entry (`Added` / `Changed` / `Fixed` / `Removed`) |
| git tags | `vX.Y.Z`, cut on `main` at the release commit |
| semver | `0.y.z` while pre-1.0: a breaking config or API change bumps `y`, additive changes bump `z`. Patch releases never change `state.json` or marketplace entry ids. |
| `dsh.plugin.json` | kept in sync by `scripts/sync-version.mjs`, which `npm version` runs |

Config compatibility is a promise worth stating plainly: `state.json` normalizes legacy shapes on load (missing `scope`, missing `status`, non-array `args`), so an older state file keeps working after an update. Downgrading is not guaranteed to be lossless — a newer state file may carry fields an older build ignores.

## How a running version is reported

| Surface | What it shows |
|---|---|
| `GET /api/dsh-mcp-center/health` | `{"ok":true,"version":"0.1.0"}` — the version of the **loaded Host half** |
| `GET /api/dsh-mcp-center/state` | the same `version` field, plus the full state payload |
| `plugin_manager {"action":"list_bundles"}` | the **installed package** version in the profile |
| Plugins page | installed version and activation state |
| MCP page → Configured | nothing version-specific; the panel is the Client half, which can legitimately be older than the Host after an update without F5 |

`health` is the honest answer to "what is running right now": it comes from the module that executed, not from a lockfile. If `health` and `list_bundles` disagree, the package on disk is newer than the running module — that is a restart, not a repair.

## The update flow for git installs

Installing over an existing package returns `already-installed`; DSH does not upgrade in place. The supported sequence is remove, then install:

```json
{"action":"remove_bundle","target":"dsh-mcp-center"}
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#v0.1.1"}
```

The Plugins page offers the same two steps as controls. Notes:

- Keep the spec shape: if you installed from a tag, update to a tag; if you installed from `main`, updating to `main` means re-resolving the branch (and you accept that it moves).
- Expect `application: "restart-required"` — replacing an installed package needs a fresh module generation. Restart DSH, then press F5 in the Web GUI.
- Removing the bundle deletes the plugin row, so the `mcp` sidebar entry disappears for the duration of the operation. Your servers are untouched (see below).
- After the restart, open the MCP page once. The plugin's startup reconcile pass re-installs any generated `@dsh-mcp-center/server-<id>` bundle that went missing and re-enables rows that were disabled, which is exactly what makes this flow safe.

## Moving between `link:` and a tagged release

Both directions are a remove plus an install with a different spec; what changes is the dependency shape in the profile.

**Development checkout → tagged release** (the normal "ship it" move):

```json
{"action":"remove_bundle","target":"dsh-mcp-center"}
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#v0.1.0"}
```

The profile dependency changes from `link:C:/Users/you/dsh-mcp` to a git spec pinned at that tag, so the checkout can be moved or deleted without breaking the install. Any local edits you were testing are gone from the running plugin — commit them, tag them, and install the tag instead.

**Tagged release → development checkout** (when you need to iterate):

```json
{"action":"remove_bundle","target":"dsh-mcp-center"}
```

```json
{"action":"install_bundle","target":"C:\\Users\\you\\dsh-mcp"}
```

The dependency becomes `link:C:/Users/you/dsh-mcp` and the directory must keep existing. Edits to `client.js` need F5; edits to `index.js` need the row to re-activate or a restart. Remember to move back to a tag before you rely on the machine for real work: a `link:` install is not pinned to anything.

## Verifying what is running

A quick, ordered check after any update:

```bash
# 1. Host half answers, and with which version
curl -s http://127.0.0.1:6922/api/dsh-mcp-center/health

# 2. The plugin sees its servers again
curl -s http://127.0.0.1:6922/api/dsh-mcp-center/state | head -c 400
```

```json
{"action":"list_bundles"}
```

Then in the UI: the `mcp` entry is present, the Configured tab lists your servers, and each card shows a tool count. If the cards show `no tools` right after the update, wait a few seconds — tool discovery is asynchronous and the page polls every 6 s — then use **Test** on one server.

## Rolling back

A rollback is the same remove + install with an older tag:

```json
{"action":"remove_bundle","target":"dsh-mcp-center"}
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#v0.1.0"}
```

Because a tag spec resolves to a commit, this is deterministic. Two caveats:

- `state.json` is not versioned. A build that introduced fields an older build does not understand will see them ignored, not migrated back; if you suspect trouble, back the file up first:

  ```bash
  cp "$DSH_HOME/mcp-center/state.json" "$DSH_HOME/mcp-center/state.json.bak"
  ```

- Generated server bundles under `$DSH_HOME/mcp-center/servers/<id>/` are rewritten by whichever build is running next, so they self-heal on the next reconcile pass.

## What an update does not touch

- `$DSH_HOME/mcp-center/state.json` and your servers, scopes and modes.
- Marketplace selections (`settings.marketplaceInstalled` in the state file).
- Other bundles in the profile.
- Secrets: they are read from `state.json` or from `env:NAME` references at materialization time, so a reinstall regenerates the same `cordis.patch.yml` with the same values.

If an update seems to have lost your servers, check the file before rebuilding anything:

```bash
ls -la "$DSH_HOME/mcp-center"
```

An empty `servers` object in `state.json` after an update means the plugin was pointed at a different `$DSH_HOME` (for example a different user or a roaming profile), not that the update deleted data.
