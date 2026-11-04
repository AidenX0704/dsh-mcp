# Troubleshooting

Symptom first, cause second, fix third. Most entries end with "reload the page" — that is not laziness: the Host half and the Client half load separately, and half the confusing states in this plugin are one of them being older than the other.

- [Quick reference](#quick-reference)
- [Sidebar entry is missing](#sidebar-entry-is-missing)
- [Panel is empty after enabling](#panel-is-empty-after-enabling)
- [Server stays red or grey](#server-stays-red-or-grey)
- [A stdio server will not start](#a-stdio-server-will-not-start)
- [HTTP server answers 401 or 403](#http-server-answers-401-or-403)
- [Tools are invisible to the model](#tools-are-invisible-to-the-model)
- [`/mcp` is unknown](#mcp-is-unknown)
- [The JSON import is rejected](#the-json-import-is-rejected)
- [State file or directory problems](#state-file-or-directory-problems)
- [Non-loopback caller gets 403](#non-loopback-caller-gets-403)
- [Duplicate server name](#duplicate-server-name)
- [`restart-required` after an install](#restart-required-after-an-install)
- [Collecting diagnostics](#collecting-diagnostics)

## Quick reference

| Symptom | Most likely cause | Fix |
|---|---|---|
| No `MCP` entry in the sidebar | page not reloaded after install; bundle disabled; Client half failed to load | [reload (F5), check the Plugins page](#sidebar-entry-is-missing) |
| Entry present, body says "Could not load" | Host route not registered, or `/state` returned `403`/`500` | [check `/health`](#panel-is-empty-after-enabling) |
| Card dot stays amber (`no tools`) | command not found, missing credential, package download failed | [read the status message, test the command in a shell](#server-stays-red-or-grey) |
| Card shows `error` | bundle install or activation failed | [read `status.message`, then `list_bundles`](#server-stays-red-or-grey) |
| `stdio` server exits immediately | `npx`/`uvx`/`docker` missing, no network, wrong path | [verify the command outside DSH](#a-stdio-server-will-not-start) |
| HTTP server returns `401` | OAuth-only endpoint, or wrong header name/scheme | [use a key-based alternative or fix the header](#http-server-answers-401-or-403) |
| Model does not use a tool that exists | `manual` mode, out of scope, or disabled | [check mode + scope](#tools-are-invisible-to-the-model) |
| `/mcp` is not a command | Host half not active | [check the row is active](#mcp-is-unknown) |
| Import says "no usable server" | flat document without `command`/`url`, or wrong group key | [use an accepted shape](#the-json-import-is-rejected) |
| `EACCES` / "cannot read state" in the Host log | `$DSH_HOME` not writable | [fix permissions](#state-file-or-directory-problems) |
| `403 forbidden` from a remote browser | loopback-only by default | [`allowRemote` + pairing](#non-loopback-caller-gets-403) |
| "A server named … already exists" | id collision | [rename or remove the old one](#duplicate-server-name) |

## Sidebar entry is missing

**Symptom.** The plugin installed successfully, but there is no **MCP** entry in the sidebar.

**Causes and fixes, in the order worth checking:**

1. **The page was not reloaded.** The Client half is a page-start module. Press **F5**. This is the answer the overwhelming majority of the time.
2. **The bundle is not selected or not enabled.** Open the Plugins page: `dsh-mcp-center` must be listed and enabled. With the tool:
   ```json
   {"action":"list_bundles"}
   ```
   Look for `installed: true`, `enabled: true`.
3. **The Host row is not active.** The Loader entry is `include:mcp-center` (patch id `mcp-center`). If the profile patch keeps it disabled, the row never activates and the Client half has nothing to attach to.
4. **The Client half failed to load.** Open the browser devtools console and look for `[dsh-mcp-center]` errors (`locale registration failed`, `dispose failed`). A failed `apply()` leaves the page without slots. Reload; if it repeats, check that the installed `client.js` is the one from this package (`list_bundles` version vs. the tag you installed).
5. **Someone else took the slot id.** If another plugin registers `sidebar.panellist` id `mcp`, only one wins. Disable the other plugin to confirm.

## Panel is empty after enabling

**Symptom.** The `MCP` entry exists, the page renders, but the body shows "Could not load" or stays on the loading line.

| Cause | Check | Fix |
|---|---|---|
| Host route missing | `curl http://127.0.0.1:<port>/api/dsh-mcp-center/health` → `404` | the row is not active, or `webServer` was unavailable at activation (the Host log says `webServer unavailable; the MCP page will not load`). Restart DSH. |
| Request rejected | `/health` → `403` | the page is not talking over loopback (proxy, remote browser) — see [Non-loopback caller gets 403](#non-loopback-caller-gets-403) |
| Host handler threw | `/health` → `500` | read the `[dsh-mcp-center] route failure:` line in the Host log |
| Client half stale | panel renders but controls do nothing, or fields are missing | F5; a stale `client.js` against a newer Host half is a supported-looking state that behaves oddly |
| Wrong port | you are curling a different port than the GUI uses | read the GUI URL; the plugin serves on that port |

A useful sanity check that isolates Host from Client: `/state` returning JSON with a `servers` array means the Host is fine and the problem is in the page.

## Server stays red or grey

**Symptom.** A card shows `no tools` (amber) or `error` (red) and never turns green.

The card's status is computed from discovered tools, not from a stored flag, so "not green" always means "the MCP client did not publish tools for this server".

| What the card says | Meaning | Next step |
|---|---|---|
| `starting` for more than ~10 s | install or activation is stuck | press **Test**; if it never returns, `list_bundles` and look at the row's phase |
| `no tools` — "no tools were discovered yet" | the client started but published nothing | **Test** → if the tool list is empty, the process/endpoint is not a working MCP server, or it needs credentials |
| `error` with a message | installation or activation failed | the message is the diagnostic; a Plugin Manager diagnostic (`cannot refresh …`, `installation failed`) means look at the generated bundle and the profile |
| `disabled` | the switch is off | turn it on — tools stay invisible while a server is disabled, by design |
| `external`, `no tools` | the row was configured outside MCP Center and is not connecting | that row's own config is at fault; MCP Center cannot edit its connection, only its mode/scope |

If a server was working and stopped: check whether the process died (`stdio` servers exit when their command fails), whether an edit changed the command, and whether the row got disabled by something else in the profile.

## A stdio server will not start

**Symptom.** `no tools` right after creation, for an entry with `command: npx`, `uvx`, or `docker`.

Work through these in order — they are ordered by how often they are the answer:

1. **The command is not on `PATH`.** DSH spawns the command without a login shell, so an `npx` that only exists in your interactive shell profile is invisible. Check with the *same* environment the Host runs in; the plugin's own environment probe reports what it can see:
   ```bash
   curl -s http://127.0.0.1:<port>/api/dsh-mcp-center/environment | head -c 300
   ```
   `hasNode` / `hasUv` / `hasDocker` / `hasPython` in that payload are ground truth for the requirement badges.
2. **No network on first run.** `npx -y <pkg>` downloads the package the first time. On a locked-down or offline machine it fails at spawn. Pre-install the package (or switch to a `uvx`/`docker` based entry) and retry.
3. **The Node floor warning is not the failure.** A marketplace entry may say "Requires Node.js 20+"; if your Node is older than the declared major, the badge turns amber but the add is not blocked. If the server then fails, the real cause is usually a syntax/`engines` mismatch inside the package — update Node to `>=22` (the plugin's own floor) and retry.
4. **The path or argument is wrong.** Run the exact command from the card's meta line in a terminal, in the same working directory. A `MODULE_NOT_FOUND` or an immediate exit with usage text tells you it is the command, not the plugin.
5. **It needs a credential.** Many servers exit with a message about a missing token. Add it in **Edit** (or as `env:NAME`), then save — a connection change reinstalls and restarts the process.
6. **Docker daemon not running.** `docker --version` succeeding only proves the CLI exists; the daemon must be up.

`stdio` servers are long-lived child processes of the Host. A crash drops the connection; the card returns to `no tools` on the next scan.

## HTTP server answers 401 or 403

**Symptom.** An HTTP (streamable-http) server shows `no tools`, and testing it or calling a tool returns `401 Unauthorized` or `403 Forbidden` from the remote end.

Note the difference from the plugin's own `403 {"ok":false,"error":"forbidden"}`: that one comes from *this* plugin and means your browser is not on loopback. A `401`/`403` mentioning `Authorization`, a www-authenticate header, or the vendor's name comes from the remote server.

| Cause | Fix |
|---|---|
| **The endpoint requires OAuth** (marketplace entries `notion`, `sentry`) | there is no OAuth flow: the shipped MCP client sends header credentials only, and the environment payload reports `oauthSupport: false`. Expect `401` and use a key-based alternative (for example the `github` or `linear` entries, which take a PAT/API key header) |
| **Wrong header name** | vendors differ: `Authorization: Bearer <token>`, `X-API-Key: <token>`, or a vendor-specific name. Copy the exact header from the vendor's MCP documentation; a swapped name looks exactly like a bad token |
| **Wrong scheme** | `Authorization: <token>` without `Bearer ` is a common failure. Put the scheme in the value |
| **`env:NAME` in the middle of a value** | only a value that *is* the reference (`env:TOKEN`) is resolved; `Bearer env:TOKEN` is stored literally. Store the scheme with the token in your environment variable, or paste the full value |
| **Token expired / wrong scope** | reissue it and paste the new value in **Edit** (an untouched field keeps the old one — you must type the new value) |
| **Endpoint path is wrong** | Streamable HTTP endpoints are usually `<host>/mcp`; a trailing path change yields 404 or a 401 from a gateway |

If the token is correct in `curl` but not from the plugin, compare the exact header map the plugin stored: masked values are shown in the card's edit drawer (`first3••••last2`), which is enough to see *which* value is in place without exposing it.

## Tools are invisible to the model

**Symptom.** The card is green with tools listed, but the model does not see or refuses to use them.

Check, in this order:

1. **Mode.** `manual` hides tools from the model by design. The card's badge says `command` instead of `automatic`. Switch with `/mcp auto <server>` or the card's **Invocation** control.
2. **Scope.** The session must be in scope. If the scope badge says `Workspaces (1)`, check that the current session belongs to that workspace or runs under its path; `Sessions (1)` with a different session id is a common miss.
3. **Enabled.** A disabled server's tools are denied everywhere, including for the model.
4. **The session predates the change.** Restrictions are re-applied within a few seconds of a state change (the Host rescans every 4 s). If the model still behaves as if the tool is missing, start a new turn — the tool list is composed per turn.
5. **The tool name.** Tools are namespaced: `mcp__<server>__<tool>`. A model asking for `echo` instead of `mcp__demo__echo` is guessing; `/mcp tools <server>` prints the exact names.
6. **Execution refused with a message.** `MCP server "<id>" is not available in this session (disabled, out of scope, or command-only)` is the guard talking — the state above changed under the model's feet, or the call came from a session that is out of scope.

`mcp_manager` itself is never hidden: if you need a hidden server's tools, the model can still reach them with `{"action":"call","id":"…","tool":"…"}`. That is the intended escape hatch, not a bug.

## `/mcp` is unknown

**Symptom.** Typing `/mcp` shows no completion, or the message "unknown command".

- The `/mcp` command is registered by the Host half. If the plugin row is not active, the command does not exist. Check `list_bundles`, then the Host log for `[dsh-mcp-center]` lines at startup: a row that failed to activate logs its reason.
- If `/mcp` completes but returns "Unknown command", you typed a subcommand that does not exist — run plain `/mcp` to see the supported list.
- The command is `mcp`, not `mcp-center`.

## The JSON import is rejected

**Symptom.** The preview reports errors, or **Create all** stays disabled.

Accepted shapes (any one of them):

```jsonc
{ "mcpServers": { "name": { "command": "…", "args": [], "env": {} } } }   // Claude Desktop / Cursor
{ "servers":     { "name": { "type": "http", "url": "…", "headers": {} } } } // VS Code
{ "name": "x", "command": "…", "args": [] }                                // one stdio server
{ "name": "x", "url": "https://…/mcp", "headers": {} }                     // one HTTP server
```

| Message | Cause | Fix |
|---|---|---|
| `The pasted JSON is empty` | empty textarea | paste a document |
| `Invalid JSON: …` | trailing comma, comment, single quotes, BOM | JSON only — no comments, double quotes |
| `Paste a JSON object describing one or more MCP servers` | the document is an array or a scalar | wrap it: `{"mcpServers": {...}}` |
| `No server entries found` | `mcpServers`/`servers` present but empty | add an entry |
| `Invalid server name "…"` | the key has spaces, dots, or is longer than 32 characters | rename the key to `[A-Za-z0-9_-]{1,32}` |
| `stdio servers need a "command"` | entry has no `command` | add one, or use `url` |
| `streamable-http servers need a "url"` | `type: "http"` with no `url` | add the endpoint |
| `Unsupported transport "…"` | something other than stdio/http | use `stdio` or `streamable-http` |

Warnings are not errors: `SSE transport is not supported by the shipped client; using streamable-http` still creates the server — check that the endpoint really speaks Streamable HTTP before trusting it.

**Create all** is disabled until a preview has succeeded with at least one valid candidate. If a candidate is invalid, nothing is created; fix the document and preview again.

## State file or directory problems

**Symptom.** The Host log shows `cannot read state: …` or `EACCES`/`EPERM`, or changes do not survive a restart.

| Cause | Fix |
|---|---|
| `$DSH_HOME` not writable | make `$DSH_HOME/mcp-center` writable by the user running DSH; on Windows check the ACL rather than the read-only attribute |
| Disk full | the atomic write needs room for a temp copy of the file |
| Another process holds the directory | two DSH instances sharing one `$DSH_HOME` will fight over `state.json` (writes are serialized per process, not across processes) — give each instance its own home |
| Hand-edited file is invalid JSON | the plugin logs a warning and starts with an empty registry; restore from a backup. Stop the Host before editing |
| `state.json` missing | not an error — the plugin starts empty and recreates it on the first change |

Permissions to expect: the file is created with mode `0600`. On Windows `git bash` may display `644` because NTFS has no POSIX mode bits — the practical protection is the directory ACL. On POSIX systems, verify with:

```bash
stat -c '%a %n' "$DSH_HOME/mcp-center/state.json"
```

## Non-loopback caller gets 403

**Symptom.** Opening the GUI from another machine, or through a reverse proxy, shows the panel with `403 forbidden` in the body, while the rest of the GUI works.

That is the plugin's own check: `remoteAddress` must be `127.0.0.1`, `::1` or `::ffff:127.0.0.1`. To allow a remote browser:

1. Set `allowRemote: true` in the plugin row's config.
2. Make sure the caller is a **paired** device of the Web UI (`remoteWebUiPairing.isPairedDevice`); pairing, not `allowRemote` alone, is what authorizes it.
3. Reload the page.

Leaving `allowRemote` off is the safer default: the API can add servers (with arbitrary commands) and call tools.

## Duplicate server name

**Symptom.** `A server named "<id>" already exists`.

The id is the key: two servers cannot share it, because it is also the row id (`mcp-center-<id>`) and the tool prefix (`mcp__<id>__`). Fix by choosing a different name, or by removing the existing server first. Marketplace entries use their catalog `id` as the server name, so a second quick add of the same entry fails the same way — the card shows a `Configured` badge instead of an enabled button for exactly this reason.

If you believe the name is free, check for an `external` server that adopted it from a profile row you configured elsewhere.

## `restart-required` after an install

**Symptom.** Install or update reports `application: "restart-required"` and the new version is not what runs.

Replacing an installed package needs a fresh JavaScript module generation; only a restart produces one. Restart DSH (or the profile), then reload the Web GUI (**F5**) so the Client half matches. Confirm with:

```bash
curl -s http://127.0.0.1:<port>/api/dsh-mcp-center/health
```

`{"ok":true,"version":"…"}` reports the version of the module that is actually executing. `application: "overridden"` is a different state — a higher-priority patch layer wins, so the row exists but is not the effective one; inspect the profile layer instead of restarting repeatedly.

## Collecting diagnostics

Everything needed to diagnose a report, in one pass:

1. **Host log lines** — the plugin logs with the `[dsh-mcp-center]` prefix:
   ```
   [dsh-mcp-center] ready: 2 MCP server(s)
   [dsh-mcp-center] cannot read state: …
   [dsh-mcp-center] webServer unavailable; the MCP page will not load
   [dsh-mcp-center] cannot restrict tools for <session>: …
   [dsh-mcp-center] route failure: …
   [dsh-mcp-center] reconcile <id>: …
   ```
   Grep the Host log for `dsh-mcp-center`.

2. **Liveness and version**
   ```bash
   curl -s http://127.0.0.1:<port>/api/dsh-mcp-center/health
   ```

3. **Full state** (masked — safe to paste into an issue, but skim it first: server ids, commands and URLs are yours)
   ```bash
   curl -s http://127.0.0.1:<port>/api/dsh-mcp-center/state > state.json
   ```

4. **Environment** — which runtimes the Host can actually see
   ```bash
   curl -s http://127.0.0.1:<port>/api/dsh-mcp-center/environment
   ```

5. **Bundle and row state**
   ```json
   {"action":"list_bundles"}
   ```

6. **Per-server test**
   ```
   /mcp test <server>
   /mcp test <server> <tool> {"…":1}
   ```

7. **The generated bundle**, if the problem looks like installation:
   ```bash
   cat "$DSH_HOME/mcp-center/servers/<id>/cordis.patch.yml"
   ```

8. **Browser console** — `[dsh-mcp-center]` errors indicate a Client-half failure; a failed `apply()` is the difference between "no entry" and "empty panel".

What *not* to paste publicly: the body of `state.json` for a server whose credentials are stored inline — masked values are safe, but titles, ids, commands and URLs are not anonymized.
