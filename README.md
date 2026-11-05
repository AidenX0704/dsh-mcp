# dsh-mcp-center

> [!WARNING]
> **Personal local build — not published to npm, and not meant for anyone else to install.**
> This repository is used only to install the plugin into one local DeepSeek Harness profile
> (a `link:` dependency pointing at this checkout). Nothing here is published to npm or to a
> mirror, and it must not be installed from one.
>
> Why it matters: the `dsh-mcp-center-ui@0.2.0` on the registry cannot boot DSH. Its client half
> registered the browser module as `dsh-mcp-center`, while the Host claims each bundle's boot-graph
> row by the package name `dsh-mcp-center-ui`; the row stayed unregistered, the loader retried and
> executed the same file twice, threw `client-modules: duplicate factory registration`, and the Web
> GUI died with `Failed to load plugins` / `web boot: 1 entry did not activate` (crash log:
> `~/Library/Logs/DeepSeek Harness/crash-*-web-boot.log`).
>
> That defect is fixed in `v0.2.1` in this repository only — it is **not** being pushed back to the
> registry. If you already installed 0.2.0 (or installed this plugin from a registry/mirror), remove
> it first and use this source instead; do not hand 0.2.0 to others.

One page for every MCP server in DeepSeek Harness: browse a curated marketplace, add a server from a manual form or a pasted `mcpServers` block, scope it to all sessions / a workspace / a session, and choose automatic or slash-command invocation.

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)
![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc-blueviolet.svg)
![tests](https://img.shields.io/badge/tests-offline%20suite%20passing-brightgreen.svg)
[![ci](https://github.com/AidenX0704/dsh-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AidenX0704/dsh-mcp/actions/workflows/ci.yml)

The `license` / `node` / `dsh` / `tests` badges are plain shields.io badges, not live services. The `ci` badge reflects `.github/workflows/ci.yml` and only shows a status once that workflow has run.

## What it does

- **Sidebar entry `mcp`** (order 40, after Plugins / Automations / Skills Center) that opens the MCP Center page in the main column.
- **Three tabs**: *Configured* (status, command or URL, tool count, scope, invocation mode, enable / edit / test / expand / delete), *Marketplace*, *Invoke*.
- **Marketplace** ships 19 curated real MCP servers plus one offline demo server: category filter, search, requirement badges (key / OAuth / Node / Python / uv / Docker / network), and a quick-add dialog generated from each entry's `fields`.
- **Two ways to add a server**: a manual form (stdio or streamable-http, command, args, env, URL, headers, timeout) and a JSON import that understands Claude Desktop / Cursor `mcpServers`, VS Code `servers`, or a single `{command}` / `{url}` object — several servers at once, with a preview before anything is created.
- **Scope** — all sessions, specific workspaces, or specific sessions. Out of scope means those tools are not merely discouraged: they leave that session's tool list and are rejected at execution.
- **Invocation mode** — `auto` puts the tools in the model's tool list; `manual` hides them and keeps them reachable only through `/mcp call`, the Invoke console, or the `mcp_manager` tool.
- **Model-side control** — the `mcp_manager` tool (`list`, `tools`, `market`, `add`, `update`, `remove`, `toggle`, `test`, `call`) and the `/mcp` command, both driving the same Host operations as the page.

## Install

The plugin is a DSH bundle. **This local build is installed by absolute path** (recorded as a `link:` dependency, so edits take effect with no release step); a git URL or `.tgz` also works, but never the npm name — `dsh-mcp-center-ui@0.2.0` on the registry keeps DSH from booting (see the warning above).

**1. Plugins page (Web GUI)** — sidebar **Plugins** → install → paste the repository URL:

```
https://github.com/AidenX0704/dsh-mcp
```

Then reload the page with **F5** — the Client half loads at page start, so the sidebar entry appears only after a reload.

**2. Agent tool call** (needs a `danger-full-access` session):

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp"}
```

The `github:AidenX0704/dsh-mcp` shorthand works for the same call.

**3. Pin a release tag** (any git ref or commit works):

```
https://github.com/AidenX0704/dsh-mcp#v0.1.0
```

**4. npm registry.** The package is published as `dsh-mcp-center-ui` — the bare `dsh-mcp-center` name on npm belongs to an unrelated project, so this one carries a `-ui` suffix:

```json
{"action":"install_bundle","target":"dsh-mcp-center-ui"}
```

Further paths — local development checkout (`link:`), `npm pack` tarball, registry — and what each one records in the profile `package.json` are in [docs/install.md](docs/install.md).

## Quick start

1. Install the bundle (one of the three snippets above) and reload the page (F5).
2. Open **MCP** in the sidebar → **Marketplace** tab.
3. Find **Local demo server** (`demo`, category *Built in*) — no network, no `npx`, no credentials — and press **Quick add** → **Create**.
4. Back on **Configured**, the card turns green with 4 tools: `echo`, `add`, `now`, `list_dir`.
5. Switch to **Invoke**, pick `demo`, pick `echo`, set the arguments to `{"text":"hello"}`, press **Run**.

The same call from the composer:

```
/mcp call demo echo {"text":"hello"}
```

## Usage

### Tabs and controls

| Tab | What it holds |
|---|---|
| Configured | One card per server: status light, transport badge, invocation badge, command + args or URL, tool count, scope summary, status message. Row actions: enable switch, **Scope**, **Test**, **Edit**, **Details** (tool list + mode switch), delete (two-step confirm). Stats row: configured / enabled / tools. |
| Marketplace | Search box, category chips, one card per entry: title, id, summary, transport, auth badge, requirement badges, `verified <date>`, **Docs** link, **Quick add**. |
| Invoke | Server select (servers with tools only), tool select, JSON arguments, **Run**, **Copy** of the result, and a `/mcp` cheat sheet with per-line copy buttons. |

Control-by-control manual: [docs/usage.md](docs/usage.md).

### Scope

| Scope | The model sees the tools when |
|---|---|
| All sessions | always |
| Workspaces | the session belongs to one of the selected workspaces, or its working directory is inside one of those workspace paths |
| Sessions | the session id is in the selected list |

A server that is out of scope for a session is denied twice: its `mcp__<server>__*` tools are removed from that session's tool list, and any attempt to execute them — including the shared `list_mcp_resources` / `read_mcp_resource` tools addressed by `server` — is rejected.

### Auto vs manual

| Mode | Model tool list | How tools run |
|---|---|---|
| `auto` | contains `mcp__<server>__*` (subject to scope) | model calls them directly; `/mcp call` and the console still work |
| `manual` | does not contain them | only `/mcp call`, the Invoke console, or `mcp_manager {"action":"call"}` |

### `/mcp` command

| Command | Purpose |
|---|---|
| `/mcp list` | All configured servers with mode, scope and tool count |
| `/mcp tools [server]` | Discovered tool names (all servers, or one) |
| `/mcp call <server> <tool> [json]` | Run one tool manually |
| `/mcp add <name> <json>` | Create a server from a connection config |
| `/mcp rm <server>` | Delete a server and its generated bundle |
| `/mcp enable <server>` / `/mcp disable <server>` | Toggle a server |
| `/mcp auto <server>` / `/mcp manual <server>` | Switch invocation mode |
| `/mcp scope <server> <all\|workspace\|session> [ids…]` | Set scope |
| `/mcp test <server> [tool] [json]` | List the server's tools, or call one |
| `/mcp market [query]` | Browse the bundled catalog |
| `/mcp` (no arguments) | The same list as built-in help |

### `mcp_manager` tool

| Argument | Used by | Meaning |
|---|---|---|
| `action` (required) | all | `list`, `tools`, `market`, `add`, `update`, `remove`, `toggle`, `test`, `call` |
| `id` | update / remove / toggle / test / call | Target server id |
| `config` | add | One server `{command,args,env}` / `{url,headers}`, or a `{mcpServers:{…}}` / `{servers:{…}}` document |
| `patch` | update | Editable fields: title, description, transport, command, args, env, cwd, url, headers, mode, scope, enabled |
| `enabled` | toggle | Desired enablement |
| `tool` | test / call | Raw tool name or full `mcp__server__tool` |
| `arguments` | test / call | JSON arguments |
| `query` | market | Free-text filter |

## Security and data

- **Loopback only.** The page talks to the Host over `/api/dsh-mcp-center` on the Web GUI's own port. A non-loopback request is answered `403` unless the plugin config sets `allowRemote: true` and the caller is a paired remote device.
- **Secrets stay in the Host.** `env` and `headers` values are masked in every response (`••••`, or first 3 + `••••` + last 2 characters). The page never receives a stored secret, and an untouched field is submitted empty and keeps its stored value.
- **`env:NAME` indirection.** Instead of storing a token, set the value to `env:GITHUB_TOKEN`. The generated bundle then contains a live `process.env.GITHUB_TOKEN` reference, and the secret never enters `state.json`.
- **State on disk.** `$DSH_HOME/mcp-center/state.json` (`~/.dsh` by default) is written with mode `0600`, because it can contain API keys. On Windows the effective permissions come from the directory ACL, so treat the file as sensitive either way.
- **Full Host privileges.** This is an ordinary in-process DSH plugin: it runs inside the Host with the same privileges as any other bundle row, can spawn the `stdio` processes you configure, and can read the environment the Host runs in. Only add servers you trust, and read a marketplace entry's `command` before adding it.

Exact schema and rules: [docs/configuration.md](docs/configuration.md).

## Compatibility

| Requirement | Value |
|---|---|
| DSH runtime | `>=0.2.0-rc` (verified against 0.2.1-rc.5 / desktop app 44.7.0) |
| Node.js | `>=22` (the Host's runtime starts `stdio` servers) |
| Browser | the Harness Web GUI; the Client half loads at page start |
| External tools | `stdio` marketplace entries need `npx`, `uvx`, or `docker` on `PATH`, plus network access on first run |

The MCP protocol is not implemented here: framing, handshakes, tool calls and resources are delegated to the shipped `@deepseek-ai/dsh-mcp-client`. This plugin only materializes configuration for it.

## Update and uninstall

Installing over an existing package reports `already-installed`. The supported update is remove, then install:

```json
{"action":"remove_bundle","target":"dsh-mcp-center-ui"}
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#vX.Y.Z"}
```

The Plugins page exposes the same remove / install controls. Restart DSH when a change reports `restart-required`; press F5 for Client-half changes. Uninstalling removes the plugin row and its generated server bundles; your configuration stays in `$DSH_HOME/mcp-center/` and can be deleted by hand.

**Upgrading from 0.1.x:** the distribution name changed from `dsh-mcp-center` to `dsh-mcp-center-ui`, so the row the bundle inserts no longer resolves against the old profile entry. Remove the old row once (`{"action":"remove_bundle","target":"dsh-mcp-center"}`) and install the new one; `$DSH_HOME/mcp-center/state.json` and the generated `@dsh-mcp-center/server-<id>` bundles are re-materialized from your saved configuration, so every server comes back with its scope and mode.

Full policy, tag rollback and `link:` ↔ release migration: [docs/update.md](docs/update.md).

## Development

No install step and no build step — the package has zero runtime dependencies.

```bash
npm test                    # offline: Host harness, Client smoke, demo selftest, MCP stdio probe
npm run test:host
npm run test:client
npm run test:demo
npm run demo                # run the demo MCP server on stdio

# live end-to-end test against a running GUI (creates and removes a demo server)
node test/run.mjs --e2e
DSH_WEB_URL=http://127.0.0.1:3637 node test/e2e-http.mjs
```

To develop against your own checkout, install by absolute path — DSH records a `link:` dependency, so edits are picked up after a rebuild / reload:

```json
{"action":"install_bundle","target":"C:\\Users\\you\\dsh-mcp"}
```

## Documentation

| Page | Contents |
|---|---|
| [docs/install.md](docs/install.md) | Every install path, what it records, prerequisites, verification, uninstall, install-failure table |
| [docs/update.md](docs/update.md) | Update and rollback policy, `link:` ↔ tag migration, version verification |
| [docs/usage.md](docs/usage.md) | Full user manual: panel controls, marketplace anatomy, import shapes, scope, modes, `/mcp`, `mcp_manager` |
| [docs/configuration.md](docs/configuration.md) | Plugin config keys, `state.json` schema, masking, generated bundles, marketplace catalog contract |
| [docs/architecture.md](docs/architecture.md) | Host/Client split, bundle materialization, HTTP API surface, scope enforcement, security model |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptom → cause → fix, plus how to collect diagnostics |
| [docs/releasing.md](docs/releasing.md) | Maintainer release checklist |

## Known limitations

- **Removing a stored secret from the panel is not wired up.** Clearing a key/value row in the edit dialog keeps the stored value (`""` means "unchanged"). The Host API does accept a delete: `POST /api/dsh-mcp-center/action` with `{"action":"update","id":"<server>","patch":{"env":{"KEY":null}}}`. Prefer `env:NAME` refs so the secret never lands in `state.json` at all.
- **Uninstall the plugin before its generated bundles.** If `dsh-mcp-center` is removed while `@dsh-mcp-center/server-<id>` rows are still installed, those servers keep loading through `@deepseek-ai/dsh-mcp-client` with no scope or invocation-mode enforcement. Delete the servers first (Configured → delete), or remove the leftover rows from the Plugins page.
- **OAuth-only marketplace entries have no OAuth flow.** Notion and Sentry are listed for their tool surface but will answer `401` until you add a token-based server instead; the GitHub and Linear entries use plain PAT headers.
- **`state.json` mode `0600` is exact on POSIX and advisory on Windows**, where the file inherits the directory ACL. Treat the file as sensitive on every platform.
- **Adopted external servers report `streamable-http`** in the edit form even when the real transport is `stdio`, because only the tool namespace is observable from the outside.

## Contributing

Bug reports, marketplace corrections and pull requests: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © AidenX0704
