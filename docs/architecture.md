# Architecture

How `dsh-mcp-center` is put together, and why. Everything described here is what the code in `index.js` (Host half, ~2100 lines) and `client.js` (Client half, ~2300 lines) actually does.

- [Two halves, one loopback bridge](#two-halves-one-loopback-bridge)
- [Why MCP framing is delegated](#why-mcp-framing-is-delegated)
- [Per-server bundles: materialize, install, discover](#per-server-bundles-materialize-install-discover)
- [Scope and invocation enforcement](#scope-and-invocation-enforcement)
- [HTTP API surface](#http-api-surface)
- [Model-facing registrations](#model-facing-registrations)
- [Client half](#client-half)
- [Security model](#security-model)
- [Lifecycle and timing constants](#lifecycle-and-timing-constants)
- [Known limits by design](#known-limits-by-design)

## Two halves, one loopback bridge

```
┌────────────────────────────── Browser (Harness Web GUI) ──────────────────────────────┐
│ client.js  — loaded by window.__ModuleLoader__ as id "dsh-mcp-center-ui"              │
│   slots: sidebar.panellist#mcp (order 40)  +  main[key=mcp]                          │
│   React from the module table, styling from --dsw-* theme tokens                      │
│   fetches /api/dsh-mcp-center/state every 6 s, POSTs /action for every mutation       │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │ loopback HTTP (JSON)
┌───────────────────────────────────────────┴───────────────────────────────────────────┐
│ index.js — Host row "mcp-center" (Cordis plugin)                                      │
│   state.json registry · scope/mode enforcement · /mcp · mcp_manager · HTTP routes      │
│   materializes one config-only bundle per server, installs it via ctx.pluginManager    │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │ profile Plugin Manager (install/remove/enable)
┌───────────────────────────────────────────┴───────────────────────────────────────────┐
│ @dsh-mcp-center/server-<id>  (generated, 2 files)                                     │
│   cordis.patch.yml → row mcp-center-<id> = @deepseek-ai/dsh-mcp-client (the real MCP)  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The two halves share no code and no build step. The Client half has no imports from any Harness Client package: `React` comes from the module table the page already provides, and the only contract is the JSON API. That is what makes the plugin installable from a tag with no bundling.

The Host half declares `export const inject = ['tools', 'commands']`; everything else it needs it resolves lazily with `ctx.get(name, false)` — `pluginManager`, `workspaceRegistry`, `sessions`, `agents`, `webServer`, `remoteWebUiPairing` — so a profile missing one of them degrades instead of crashing (for example, no `webServer` logs a warning and the page has nothing to talk to).

## Why MCP framing is delegated

This plugin never speaks MCP. It contains no JSON-RPC framing, no `initialize` handshake, no transport code. Every configured server becomes a **configuration** for the shipped `@deepseek-ai/dsh-mcp-client`, which owns the protocol.

Reasons, in the order the code's comments give them:

- One implementation of a fast-moving protocol. The client already handles stdio and Streamable HTTP, tool discovery, resource listing and cancellation; a second implementation would drift.
- Rows, enablement, hot module replacement and uninstall keep working exactly like any other plugin row, because the MCP client is installed *as* a plugin row — not as something this plugin drives out-of-band.
- Nothing here rewrites the profile patch or the profile `package.json`; `ctx.pluginManager` owns both.

The consequence to remember: if a server's protocol shape changes (an endpoint drops Streamable HTTP, a package switches transport), MCP Center cannot compensate. It reports what the client reports.

## Per-server bundles: materialize, install, discover

The lifecycle of one server, with the exact steps the Host performs:

| Step | Trigger | What happens |
|---|---|---|
| **create** | `create` action / `/mcp add` / `mcp_manager add` | the draft is validated (name `^[A-Za-z0-9_-]{1,32}$`, command for stdio, url for http), stored with `status.phase = installing`, and persisted before anything is installed |
| **materialize** | `materializeBundle(server)` | `revision += 1`; writes `servers/<id>/package.json` (`@dsh-mcp-center/server-<id>`, version `0.1.<revision>`) and `cordis.patch.yml` (row `mcp-center-<id>` inserting `@deepseek-ai/dsh-mcp-client` with the server's connection config) |
| **install** | `ensureInstalled(server)` | asks `pluginManager.listBundles()`; if the bundle is already installed **and** enabled it is a no-op; if installed but disabled it calls `setBundleEnabled(name, true)`; otherwise `installBundle(dir, { enabled: true, saveExact: true })`. On an edit it first `removeBundle(name)` so the new revision really loads |
| **discover** | `waitForTools(id, 8000)` | polls `syncTools()` (which reads `ctx.tools.schemas()` and groups names by the `mcp__<id>__` prefix) every 400 ms for up to 8 s; also gives up early if the row reports `fiberPhase === 'failed'` or the server was disabled. Result: `ready`, or `pending` with the message "Installed, but no tools were discovered yet" |
| **update** | `updateServer(id, patch)` | compares `JSON.stringify(clientConfig(server))` before and after; only a *connection* change triggers the reinstall path (mode/scope/title/description do not) |
| **enable/disable** | `toggleServer(id, next)` | flips `enabled` in state, then `setPluginEnabled(entryId, …)` on the row; re-installs a bundle that had been removed |
| **remove** | `removeServer(id)` | `removeBundle(bundleName)` → `rm -rf servers/<id>` → delete the state record → rescan tools |

Tool discovery is the only source of truth for "does this server work": `server.toolCount` and the card's status are derived from the registered `mcp__<id>__*` schemas, not from a stored flag.

Beyond explicit actions, two background passes keep reality aligned:

- **`discoverExternal()`** at startup and on `refresh`: any `@deepseek-ai/dsh-mcp-client` row in the profile that MCP Center did not create is adopted as an `external` server record (read-only connection, mode/scope manageable), so its tools are not invisible to the scope machinery.
- **`reconcile()`** at startup: re-installs generated bundles whose rows vanished, and re-enables rows found disabled — which is what makes remove-then-install updates survivable.

## Scope and invocation enforcement

Scope and mode are enforced per **agent**, using the tool APIs on that agent's own context — not by filtering UI output:

```
computeDeny(agent)
  for each server:
    tools = toolsByServer[server.id]
    if disabled            → deny all of its tools
    else if !inScope(...)  → deny
    else if mode == manual → deny
```

`refreshAgent(agentId)` registers, inside the agent's context effect:

1. `ctx.tools.restrict({ deny })` — the denied names leave the session's tool list, so the model cannot even see them.
2. `ctx.tools.guard(fn)` — a per-execution check that returns a denial message. This covers the window where the model saw a tool before a scope/mode change, and covers the shared resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) which are registered globally and addressed by a `server` argument rather than a prefix.

Re-registration is driven by two counters: `toolsRev` (the discovered tool signature changed) and `stateRev` (state was written). Agents are adopted from `agent/created` / `agent/disposed` events *and* by a `trackLiveAgents()` sweep, because activation and HMR can happen after agents already exist.

`inScope(server, sessionId, cwd)` resolves `workspace` scope twice: by workspace membership (registry says the workspace owns the session) and by path (the session's `cwd` equals or sits under a selected workspace path, case-insensitively). This is why a workspace-scoped server still works for a session opened in that directory after the workspace record changed.

The HTTP action path and the `/mcp` command deliberately bypass agent restrictions: they run in the Host on the user's behalf. That is the intended difference between "the model may use this" and "I may use this".

## HTTP API surface

Registered as a `prefix` route on the profile's `webServer` at `/api/dsh-mcp-center`. Body limit 2 MiB.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dsh-mcp-center` | full state (same payload as `/state`) |
| `GET` | `/api/dsh-mcp-center/state` | full state: `version`, `servers[]` (masked views), `marketplace`, `environment`, `counts` |
| `GET` | `/api/dsh-mcp-center/health` | `{ ok: true, version }` — liveness and the loaded plugin version |
| `GET` | `/api/dsh-mcp-center/environment` | probed environment (platform, node/python/uv/docker versions, workspaces, sessions, `dataDir`, demo descriptor, version) plus a marketplace summary |
| `POST` | `/api/dsh-mcp-center/action` | `{ action, ...payload }` — every mutation and query |
| `POST` | `/api/dsh-mcp-center` | same handler; `action` defaults to `state` |
| any | anything else under the prefix | `404 { ok: false, error: "Unknown route …" }` |

Status codes: `403` for a caller that is not allowed (see [Security model](#security-model)), `400 { ok: false, error }` when an action throws, `500` when the route handler itself throws, `200` otherwise.

Actions accepted by `POST /action`:

| Action | Payload | Result |
|---|---|---|
| `state` | — | full state |
| `environment` | — | environment payload |
| `preview` | `json` | parsed import document: `candidates[]` with `draft`/`errors`/`warnings` |
| `create` | `json` (import) or the flat form fields (`name`, `transport`, `command`, `args`, `cwd`, `url`, `env`, `headers`, `mode`, `scope`), plus optional `fields` for `${KEY}` substitution | created server view(s) |
| `update` | `id`, `patch` | updated server view (may reinstall) |
| `remove` | `id` | `{ id, removed }` |
| `toggle` | `id`, `enabled` | server view |
| `test` | `id`, `tool?`, `arguments?` | tool list, or the call result |
| `call` | `id`, `tool`, `arguments?` | `{ isError, value, content, error }` |
| `reconcile` | — | re-runs the startup reconcile pass |
| `refresh` | — | re-runs external discovery and returns fresh state |

`preview`, `create`, `update`, `remove`, `toggle`, `test` and `call` are exactly what the page's buttons use; there is no second, private path.

## Model-facing registrations

| Surface | Where | Notes |
|---|---|---|
| `mcp_manager` tool | `ctx.tools.register` | actions `list`, `tools`, `market`, `add`, `update`, `remove`, `toggle`, `test`, `call`; `isConcurrencySafe: () => false`; output rendered as pretty JSON |
| `/mcp` command | `ctx.commands.register` | `list`, `tools`, `call`, `add`, `rm`, `enable`, `disable`, `auto`, `manual`, `scope`, `test`, `market`, plus built-in help |
| `mcp__<id>__*` tools | registered by the shipped MCP client, one namespace per server | the plugin only reads their schemas; it never registers them |
| resource tools | registered by the shipped client, global | guarded by the plugin through `ctx.tools.guard` |

Tool calls made by the plugin (`test`, `call`, Invoke console) go through `ctx.tools.execute` with a generated `callId`, an `AbortController` wired to the caller's signal, and a hard 120 s ceiling on top of any `toolCallTimeoutMs` the server configures.

## Client half

`client.js` is a single `window.__ModuleLoader__.load({ id, factory })` call. The factory receives `require` and takes `react` from the module table; there is no JSX and no bundler, so element construction is `h(...)`.

`id` is not a label the plugin gets to choose: the Host keys each boot-graph row by the package's **resolved name** (`graphRow(packageName, …)`), and the row is satisfied only when a script registers exactly that id. It must therefore equal `package.json` `name` — `dsh-mcp-center-ui`, while the locale namespace and the HTTP route keep the shorter `dsh-mcp-center`. Registering under another id makes the loader treat the row as unregistered, retry it, re-execute the same file and fail the boot with `client-modules: duplicate factory registration`; `test/client-smoke.mjs` asserts the pair.

Inside `apply(ctx)`:

1. `ctx.locale.register('dsh-mcp-center', { zh, en })` — every string in the panel is a dictionary entry with both languages; `ctx.locale.bind(NS)` supplies `t()`, and a subscription re-renders on locale change.
2. `slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: 'mcp', order: 40, label: () => t('title') }, McpPanelIcon))` — the sidebar button and its inline SVG icon.
3. `slots.inject('main', () => slots.register({ name: 'main', key: 'mcp' }, McpPage))` — the page in the main column.

State handling is a small store hook: `fetchState()` on mount and every 6 s, `postAction(action, payload)` for mutations, a `busy` key per in-flight control (so one button spins and the others do not), and a 4 s toast for the outcome.

Styling uses **theme tokens only** — every color, border and surface in the injected stylesheet is a `var(--dsw-alias-…)` (for example `--dsw-alias-bg-base`, `--dsw-alias-label-primary`, `--dsw-alias-border-l1`, `--dsw-alias-brand-primary`, `--dsw-alias-state-success-primary`, `--dsw-alias-state-warn-primary`, `--dsw-alias-state-error-primary`, `--dsw-alias-bg-layer-1|2`, `--dsw-alias-bg-overlay`) with `color-mix()` for translucent variants, plus `--ds-font-family-code` for monospace. Nothing hard-codes a hex color, so light and dark themes both work without a second stylesheet.

The module also exports a `__test` surface (`McpPage`, tab components, `evaluateRequirement`, `CSS`, …). The module loader reads only `inject` and `apply`, so it is inert in the page and exists so `test/client-smoke.mjs` can render every component path with a React stub, offline.

## Security model

| Layer | Mechanism |
|---|---|
| Transport | the API is served on the Web GUI's own port; there is no separate listener |
| Authorization | `isLoopback(request)` accepts `127.0.0.1`, `::1`, `::ffff:127.0.0.1`. Anything else is `403`, unless `allowRemote: true` **and** `remoteWebUiPairing.isPairedDevice(request) === true` |
| Response hygiene | `serverView()` masks every `env`/`header` value; `cache-control: no-store`; the Client half never receives a secret |
| Write hygiene | state writes are atomic and serialized; `mode 0600` |
| Secret redirection | `env:NAME` becomes `!!js process.env.NAME` in the generated YAML instead of a literal |
| Blast radius | the plugin runs **in-process** with full Host privileges: it can launch the commands you configure and read the Host's environment. Its trust boundary is the profile, not a sandbox |

The `guard` layer is a policy control, not a security boundary against a malicious model: a manual-mode tool is still executable by anything that can reach the HTTP API. The real boundary for remote callers is the loopback/pairing check.

## Lifecycle and timing constants

| Constant | Value | Where |
|---|---|---|
| tool rescan + agent refresh interval | 4 s (`unref`'d) | Host poller |
| client state poll | 6 s | `useMcpStore` |
| tool-discovery wait after create | 8 s, polled every 400 ms | `waitForTools` |
| tool-discovery wait after edit | 6 s | `updateServer` |
| environment probe cache | 60 s | `probeEnvironment` |
| tool-call ceiling | 120 s | `callTool` |
| HTTP body limit | 2 MiB | `readBody` |
| toast lifetime | 4 s | client |
| delete-confirm arming | 4 s | `ServerCard` |

Shutdown is effect-scoped: a dispose effect marks the plugin `disposed`, releases every agent's restriction, and the route/command/tool registrations are dropped with their `ctx.effect` disposers. Generated bundles stay installed — they belong to the profile, and the next activation adopts them.

## Known limits by design

- **No OAuth flow.** The shipped client sends header credentials only, so `auth: "oauth"` marketplace entries cannot complete a browser authorization; expect `401`. The environment payload reports `oauthSupport: false` and the UI renders those badges as warnings.
- **SSE is not supported.** Imports declaring `type: "sse"` are converted to `streamable-http` with a warning.
- **External servers are read-only.** Adopted rows expose mode/scope only, and their transport is recorded as a placeholder because only the tool namespace is observable.
- **Resources have no browser in the panel.** They are model-facing tools; the panel covers tools only.
- **Secrets cannot be deleted from the UI.** The editor sends `""` for "keep"; deleting a key needs the API's explicit `null` (see [configuration.md](configuration.md#secret-handling)).
- **One data directory per Host.** `dataDir` is process-wide; two Hosts sharing `$DSH_HOME` share one registry.
