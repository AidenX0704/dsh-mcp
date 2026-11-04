# Installing `dsh-mcp-center-ui`

`dsh-mcp-center-ui` is a **DSH bundle**: a package that carries a Cordis patch (`cordis.patch.yml`) inserting one Host row, plus an optional Client half that the Web GUI loads at page start. Installation is therefore not a file copy — it is a dependency installed into a **profile** and a bundle selected in that profile's `dsh.profile.bundles` list. Both steps are owned by DSH's Plugin Manager; you never edit the profile by hand.

This page documents every supported install path, what each one records, how to verify it, how to remove it, and what the failure codes mean.

- [Prerequisites](#prerequisites)
- [Path 1 — Plugins page (Web GUI)](#path-1--plugins-page-web-gui)
- [Path 2 — Agent tool call (`plugin_manager`)](#path-2--agent-tool-call-plugin_manager)
- [Path 3 — Pin a git tag or commit](#path-3--pin-a-git-tag-or-commit)
- [Path 4 — Local checkout (`link:`)](#path-4--local-checkout-link)
- [Path 5 — Tarball](#path-5--tarball)
- [Path 6 — npm registry](#path-6--npm-registry)
- [What each path records](#what-each-path-records)
- [`restart-required`](#restart-required)
- [After install: reload the page](#after-install-reload-the-page)
- [Verification](#verification)
- [Uninstall and data cleanup](#uninstall-and-data-cleanup)
- [Install failure reference](#install-failure-reference)

## Prerequisites

| Item | Why | Check |
|---|---|---|
| DSH `>=0.2.0-rc` | the plugin uses the Plugin Manager service, `ctx.tools.restrict` / `guard`, and the Web GUI route registration the bundle API provides | the app's About / Plugins page shows the runtime version (this repository is verified against `0.2.1-rc.5`, desktop app `44.7.0`) |
| Node.js `>=22` | `engines.node` in `package.json`; also the runtime that starts `stdio` marketplace servers | `node --version` |
| `git` | only for git installs (paths 1–3) | `git --version` |
| network | only for git / registry / tarball installs, and for `stdio` servers' first run | — |
| a writable `$DSH_HOME` | state and generated bundles live under `$DSH_HOME/mcp-center/` | default `~/.dsh` |

**pnpm**: DSH ships and invokes its own package-manager invocation. Do not run `pnpm` in the profile directory yourself — installing, removing and the lockfile are the Plugin Manager's job, and a hand-edited profile is how installations get out of sync.

The plugin itself has **zero runtime dependencies**, so nothing is compiled, no install script runs, and installation is just a dependency record plus a bundle selection.

## Path 1 — Plugins page (Web GUI)

1. Sidebar → **Plugins** (插件).
2. Use the install control and paste the repository URL:

   ```
   https://github.com/AidenX0704/dsh-mcp
   ```

3. Confirm. The page reports the install outcome; `already-installed` means a package of that name is already present (see [Update](update.md)).
4. Reload the page with **F5**. The Client half is loaded when the page boots (`dsh.client.immediately: true`), so the `mcp` sidebar entry does not appear without a reload.

The Plugins page is the recommended path if you just want the plugin: it shows the resulting bundle state, the declared version, and any activation problem in place.

## Path 2 — Agent tool call (`plugin_manager`)

The `plugin_manager` tool performs the same operation, and is the only way to install from a terminal-only session. It requires a session with **danger-full-access**, because it changes the profile on disk.

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp"}
```

Equivalent shorthand:

```json
{"action":"install_bundle","target":"github:AidenX0704/dsh-mcp"}
```

The tool accepts a package name, an absolute path, a git URL (including `github:owner/repo`), or a URL to a `.tgz`. Useful companions:

```json
{"action":"list_bundles"}
```

```json
{"action":"remove_bundle","target":"dsh-mcp-center-ui"}
```

`install_bundle` reports:

| Field | Meaning |
|---|---|
| `application` | `activated` / `restart-required` / `overridden` / `failed` — what happened to the running runtime |
| `pendingBuilds` | packages whose install scripts were withheld; approve them only after reading what they run |
| `error.code` | the failure code (`invalid-spec`, `not-found`, `not-a-bundle`, `incompatible-version`, …) — see [Install failure reference](#install-failure-reference) |

## Path 3 — Pin a git tag or commit

Any git ref works as a fragment:

```
https://github.com/AidenX0704/dsh-mcp#v0.1.0
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#v0.1.0"}
```

```
https://github.com/AidenX0704/dsh-mcp#9c1b0f4
```

Tags are cut as `vX.Y.Z` on GitHub; the version that actually ends up installed is always the one in `package.json` at that ref (check `CHANGELOG.md` for what changed). Pinning is the right default for anything you intend to keep: a branch spec follows the branch, a tag spec does not.

## Path 4 — Local checkout (`link:`)

For development, install the checkout you are editing by absolute path:

```json
{"action":"install_bundle","target":"C:\\Users\\you\\dsh-mcp"}
```

A path spec records a **link dependency**, so the profile points at your working tree instead of a copy: edit `index.js` / `client.js`, then rebuild or reload and the running plugin picks the change up (Host-half code needs the row to re-activate; Client-half code needs F5).

Two consequences worth knowing before you choose this path:

- The directory must keep existing. Delete or move it and the profile dependency dangles.
- `link:` installs are not a release: nothing is pinned, `version` in the profile is whatever your `package.json` currently says.

On Windows, prefer a forward-slash absolute path (`C:/Users/you/dsh-mcp`) if the backslash form ever trips the spec parser.

## Path 5 — Tarball

```bash
npm pack
# dsh-mcp-center-ui-0.2.0.tgz
```

Install by absolute path to the `.tgz`:

```json
{"action":"install_bundle","target":"C:\\Users\\you\\dsh-mcp\\dsh-mcp-center-ui-0.2.0.tgz"}
```

`npm pack` runs the `prepack` hook (`node test/run.mjs --offline`), so a broken offline suite blocks packaging. The published file list is the `files` field in `package.json` — `index.js`, `client.js`, `cordis.patch.yml`, `data/`, `demo/`, `locale/`, `docs/*.md`, `icon.svg`, `README*`, `CHANGELOG.md`, `LICENSE`. Tests and `test/` are not shipped; the offline suite runs from a checkout.

A tarball is the only path that works offline once you have the file, which makes it the practical choice for a machine without git or registry access.

## Path 6 — npm registry

The package is publishable (`publishConfig.access: public`, `files` and `engines` set, `npm pack` verified), so once a version is published it installs like any other bundling package:

```json
{"action":"install_bundle","target":"dsh-mcp-center-ui"}
```

```json
{"action":"install_bundle","target":"dsh-mcp-center-ui@^0.2.0"}
```

The published name is **`dsh-mcp-center-ui`**: the bare `dsh-mcp-center` on npm belongs to an unrelated project, so this package carries the `-ui` suffix. If you install an older copy from that name, remove it first.

Check the registry first — if nothing is published yet, this path fails with `not-found`. Use the git URL until it is.

## What each path records

The profile `package.json` (under `$DSH_HOME/profiles/<profile>/`) is the record of truth. Observed shapes after real installs:

| Path | `dependencies` entry | Notes |
|---|---|---|
| Absolute local path | `"dsh-mcp-center-ui": "link:C:/Users/you/dsh-mcp"` | points at your working tree; nothing is copied or pinned |
| Git URL / `github:owner/repo` | a git spec **pinned to the resolved commit**, e.g. `"dsh-startup-screen": "github:6shenhonghong9/dsh-startup-screen#1f35ea33…"` | the spelling follows the spec you passed (`github:…#<sha>`, or a `git+https://…#<ref>` form for URL specs); the ref is always resolved to a commit, so the install is reproducible |
| Git tag | same git spec, `<ref>`/`<sha>` of that tag | `#v0.1.0` is not a moving target — this is the recommended production shape |
| Registry | a **version range or exact version**, depending on the spec you passed — `"dsh-free-search": "^0.9.0"` and `"dsh-gitbash-shell": "0.35.1"` are both real examples from this profile | a range follows the registry, an exact version does not |
| Tarball | a file/path dependency pointing at the `.tgz` you passed | the file must stay where it is while the install is in use |

Alongside the dependency, the bundle name is added to `dsh.profile.bundles` — that list decides what the running profile actually loads.

Everything the plugin itself creates is separate and lives under `$DSH_HOME/mcp-center/`:

```
$DSH_HOME/mcp-center/state.json              # registry (mode 0600)
$DSH_HOME/mcp-center/servers/<id>/           # one generated bundle per configured server
    package.json                             #   name: @dsh-mcp-center/server-<id>
    cordis.patch.yml                         #   row mcp-center-<id> → @deepseek-ai/dsh-mcp-client
```

Those generated bundles appear in the profile's `dependencies` as `link:` entries too — that is normal, and it is why removing the plugin leaves them behind until you remove the servers (or the directory).

## `restart-required`

DSH applies bundle changes at runtime, but not all of them. When `install_bundle` (or `remove_bundle`) returns `application: "restart-required"`, the package is installed on disk and **not** live: replacing an already-installed package needs a fresh JavaScript module generation, which only a restart produces.

- New install: usually activates through HMR, no restart.
- Update (remove + install): expect `restart-required`.
- The reason is reported with the change; keep it in the reply rather than claiming success.
- After restarting DSH (or the profile), press F5 in the Web GUI so the Client half reloads too.

`application: "overridden"` is different: a higher-priority configuration layer wins, so the row exists but is not the one in effect. Inspect the profile patch layer before assuming the install failed.

## After install: reload the page

The Client half is a page-start module (`window.__ModuleLoader__`, `dsh.client.platform: "web"`, `immediately: true`). Consequences you will hit at least once:

- The `mcp` sidebar entry appears only after **F5**.
- Changes to `client.js` require F5; changes to `index.js` require the Host row to re-activate (HMR) or a restart.
- A stale page can show an old panel against a new Host half — reload before debugging a mismatch.

## Verification

Four checks, cheapest first:

1. **Plugins page** — the bundle is listed, enabled, and its declared version matches `package.json`.
2. **Bundle list**

   ```json
   {"action":"list_bundles"}
   ```

   Look for `dsh-mcp-center-ui` with `installed: true`, `enabled: true`.

3. **Sidebar** — the **MCP** entry exists (id `mcp`, order 40, after Plugins / Automations / Skills Center) and shows a page with three tabs.
4. **HTTP API** — the Host half is answering on the Web GUI's own port:

   ```bash
   curl http://127.0.0.1:6922/api/dsh-mcp-center/health
   # {"ok":true,"version":"0.1.0"}
   ```

   Replace `6922` with the port the GUI actually uses (the default used by the test scripts is `3637`). `/api/dsh-mcp-center/state` returns the full payload and reports the running `version`.

A `403` here means the request did not arrive over loopback (or `allowRemote` is off and the caller is not a paired device) — that is the plugin's security model working, not a broken install.

## Uninstall and data cleanup

```json
{"action":"remove_bundle","target":"dsh-mcp-center-ui"}
```

Or the Plugins page's remove control. That deselects the bundle, unloads its runtime contributions and removes the dependency — including the plugin row and the `mcp` sidebar entry.

Your configuration is **not** deleted. To start from scratch afterwards:

1. In the plugin, remove each configured server (**Configured** → trash icon → confirm). This also removes `servers/<id>/` and the generated `@dsh-mcp-center/server-<id>` bundle.
2. Or, after uninstalling the plugin, delete the directory:

   ```bash
   # inspect before deleting
   ls "$DSH_HOME/mcp-center"
   rm -rf "$DSH_HOME/mcp-center"
   ```

   `$DSH_HOME` defaults to `~/.dsh`.

If you leave generated bundles behind, they stay installed as bare plugin rows: their MCP client keeps running and their tools stay visible to the model, but MCP Center has no record of them — so no scope, mode or test controls. Remove them from the Plugins page (or delete `servers/<id>/` **and** its row) rather than leaving orphans.

## Install failure reference

`install_bundle` returns a failure with a `code` (spec resolution) or a `failedAt` stage plus a `kind` (package management). Codes come from DSH, not from this plugin.

| Code / kind | Cause | Fix |
|---|---|---|
| `invalid-spec` | the `target` is not a package name, absolute path, git URL or `.tgz` URL — a relative path, a folder with no `package.json`, or a stray fragment is the usual reason | pass an absolute path (`C:\\Users\\you\\dsh-mcp`) or a full URL; on Windows avoid trailing backslashes |
| `not-found` | nothing matched that name/ref/repository: unpublished registry package, wrong owner/repo, or a tag that does not exist | check the repository URL and `git ls-remote --tags <url>` for the tag name |
| `not-a-bundle` | the target installed but declares no `dsh.bundle.patch` — it is a plain package, or a Client-only plugin | install a package whose `package.json` has `dsh.bundle.patch`; this one has `"./cordis.patch.yml"` |
| `incompatible-version` | a declared requirement is unmet — `engines.dsh` (`>=0.2.0-rc` here) or a DSH peer package | update DSH; the refusal lists `name`, `version`, `runtimeVersion` and the unmet requirements |
| `pnpm-missing` | DSH could not find or start its package-manager invocation | reinstall/repair the DSH runtime; do not install pnpm into the profile yourself |
| `network` / `timeout` | the git host or registry was unreachable, or the operation timed out | retry on a working connection; behind a proxy configure it for DSH, not for a shell |
| `failedAt: "spec-host"` | fetching the spec from its host failed (repository lookup or credential prompt) — the check disables credential helpers and prompts on purpose | use a URL that needs no interactive login, or install from a local clone/tarball |
| `build-blocked` / `pendingBuilds` | the package (or a dependency) has install scripts that were withheld | decide whether to approve them; this plugin has none, so a build block here means the spec points at something else |
| `integrity` | the downloaded artefact did not match the recorded integrity | clear the DSH package cache and retry |
| `disk-full` / `permission` | the profile directory or cache is not writable | check free space and `$DSH_HOME` ownership |
| `already-installed` | a package with that name is already in the profile — this is also what an update looks like | see [docs/update.md](update.md): remove, then install |

After any fix, re-run the verification steps above rather than trusting the install message alone.
