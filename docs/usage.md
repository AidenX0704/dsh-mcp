# User manual

Everything the MCP Center page and its two model-facing surfaces (`/mcp` and the `mcp_manager` tool) can do. For install and update, see [install.md](install.md) and [update.md](update.md).

- [Where it lives](#where-it-lives)
- [Page layout](#page-layout)
- [Configured tab](#configured-tab)
- [Marketplace tab](#marketplace-tab)
- [Adding a server](#adding-a-server)
- [Editing a server](#editing-a-server)
- [Scope](#scope)
- [Automatic vs manual invocation](#automatic-vs-manual-invocation)
- [Invoke tab](#invoke-tab)
- [`/mcp` command reference](#mcp-command-reference)
- [`mcp_manager` reference](#mcp_manager-reference)
- [Testing a server](#testing-a-server)
- [MCP resources](#mcp-resources)

## Where it lives

The plugin adds one sidebar entry, **MCP**, in `sidebar.panellist` with id `mcp` and order `40` — after Plugins (`0`), Automations (`10`) and Skills Center (`30`). Selecting it renders the MCP Center page in the main column. The page is one component; all three tabs share the same loaded state.

## Page layout

```
┌ header ─────────────────────────────────────────────────────────────┐
│ MCP                                        [ Refresh ] [ + Add server ]
├ tabs ───────────────────────────────────────────────────────────────┤
│ Configured (3)   Marketplace (20)   Invoke                          │
├ body ───────────────────────────────────────────────────────────────┤
│ stats: 3 configured · 2 enabled · 11 tools                          │
│ …tabs content…                                                      │
├ footer ─────────────────────────────────────────────────────────────┤
│ Configuration lives in the Host; secrets never travel back to this page.
└─────────────────────────────────────────────────────────────────────┘
```

- **Refresh** re-fetches `/state`. The page also polls every 6 s on its own, so tool counts and status catch up without a click.
- **+ Add server** opens the create drawer.
- Transient notices (saved, removed, test result, error) appear as a pill above the content and auto-dismiss after 4 s.
- If the state cannot be fetched, the body is replaced by an error block with its own **Refresh** button.

## Configured tab

Empty state offers three buttons: **Add server** (jumps to the Marketplace tab), **Manual setup** and **Import JSON** (both open the create drawer), plus a hint that `/mcp list` and `/mcp call` exist.

With servers present, a stats row (**configured / enabled / tools**) sits above one card per server.

### Card anatomy

| Element | Meaning |
|---|---|
| Status dot + badge | `connected` (ready), `starting`, `no tools` (pending), `error`, `disabled` |
| Title + mono id | display title and the server id, which is also the tool prefix `mcp__<id>__` |
| Transport badge | `local process` (stdio) or `remote HTTP` (streamable-http) |
| `external` badge | the row was configured outside MCP Center (see below) |
| Invocation badge | `automatic` or `command` |
| Meta line | `command args…` for stdio or the URL for HTTP, tool count, scope summary, last status message |
| Switch | enable / disable the server's row |
| **Scope** | opens the scope editor inline |
| **Test** | lists the server's tools (and reports the row's runtime phase); expands the card |
| **Edit** | opens the edit drawer |
| **Details** / **Collapse** | expands the card body: mode switch, tool list, `/mcp call` hint |
| Trash | two-step delete: first click arms it (turns into **Confirm delete**, disarms after 4 s), second click deletes |

**External servers.** If a profile already contains a `@deepseek-ai/dsh-mcp-client` row that MCP Center did not create, the plugin adopts it as a read-only `external` server so scope and invocation mode stay manageable in one place. Its connection fields cannot be edited (only mode, scope, labels), and it cannot be deleted from this page — remove its row from the profile patch instead. Its recorded transport is a placeholder (`streamable-http`), because the plugin only sees the resulting tool namespace.

### Status meanings

| Badge | Phase | What it means |
|---|---|---|
| connected | `ready` | the shipped MCP client is running the server and its tools are registered |
| starting | `installing` / `starting` / `updating` | the generated bundle is being installed or the process/HTTP session is coming up |
| no tools | `pending` | installed, but no tools were discovered — usually a bad command, a missing credential, or a `stdio` dependency that is not on `PATH` |
| error | `error` | installation or activation failed; the status message carries the diagnostic |
| disabled | — | the row is turned off; its tools are removed from every session's tool list |

### Scope editor

Press **Scope** on a card. A segmented control picks the scope kind and the list below it shows the options the Host currently reports:

| Kind | Selection list |
|---|---|
| All sessions | none |
| Workspaces | checkbox per workspace, showing its title and path |
| Sessions | checkbox per live session, showing a shortened session id and its `cwd` |

**Save scope** submits the change. Scope edits do not reinstall or restart the server — they only change who may see it.

### Mode switch

Expanding a card shows a **Invocation** segmented control (`Auto` / `Manual`) with a one-line explanation of the current choice. Switching is immediate and does not reconnect the server.

## Marketplace tab

The tab lists the bundled catalog: 19 curated servers plus the built-in **Local demo server**, rendered as a grid of cards. Everything is static and shipped with the package — the marketplace works with no network.

### Controls

| Control | Behaviour |
|---|---|
| Search box | case-insensitive match against entry id, title (`zh` + `en`), summary and tags |
| Category chips | `All` plus every category in the catalog: *Built in*, *Official reference*, *Docs*, *Devtools*, *Vendor*, *Data*, *Search*, *Infra* |
| Refresh | re-runs the Host's external-row discovery and republishes state |
| **Quick add** | opens the quick-add drawer (disabled when that server is already configured) |
| **Docs** | opens the entry's `docs` URL in a new tab |
| `verified <date>` | the date the entry's command/URL was last confirmed against upstream docs |

### Entry anatomy

| Field | Shown as |
|---|---|
| `id` | mono text next to the title; also the server id you will get |
| `title` / `summary` | localized (`zh` or `en` depending on the active UI locale) |
| `transport` | `local process` / `remote HTTP` badge |
| `auth` | `Needs a key` (api-key), `Browser authorization` (oauth / local-token), `No key needed` |
| `requirements[]` | one badge per requirement, prefixed by an icon: key, OAuth, Docker, Python/uv, Node, network |
| `Configured` badge | a server with this id already exists |

Requirement badges are evaluated against what the Host can actually see:

| `kind` | Met when | Notes |
|---|---|---|
| `node` | the Host's Node is present | if the entry names a major version above the running one, the badge turns amber (warning only — quick add still works) |
| `python` | `python` (Windows) / `python3` is on `PATH` | — |
| `uv` | `uv` is on `PATH` (`uvx` comes with it) | — |
| `docker` | `docker` answers | a running daemon is still required at call time |
| `api-key` | always | you supply the secret in the drawer |
| `oauth` | never, for now | the shipped MCP client sends header credentials only; the badge stays amber (see [troubleshooting](troubleshooting.md#http-server-answers-401-or-403)) |
| `network` | informational | shown as a plain badge |

A requirement with `hard: true` (the default; `hard: false` makes it informational) blocks creation until you tick **Add anyway** in the quick-add drawer. Amber means "you were warned", not "impossible".

## Adding a server

**+ Add server** opens a drawer with two tabs, **Manual setup** and **Import JSON**. Escape or a click on the backdrop closes it.

### Manual form fields

| Field | Required | Notes |
|---|---|---|
| **Name** | yes (new servers only) | 1–32 characters from `A-Z a-z 0-9 _ -`. It becomes the server id and the tool prefix `mcp__<name>__`, and it cannot be changed after creation |
| **Display name** | no | free text shown on the card; defaults to the id |
| **Transport** | yes | `local process` (stdio) or `remote HTTP` (streamable-http) |
| **Command** | stdio only | e.g. `npx`, `node`, `uvx`, `docker`, or an absolute path to an executable |
| **Working directory** | no | `cwd` for the child process |
| **Arguments** | no | one argument per line. A single line may also be pasted space-separated (quotes are honored), and the Host additionally accepts a JSON array |
| **Environment** | no | key/value rows for stdio servers. Values are secret inputs; `env:NAME` references a process environment variable instead of storing the secret |
| **Endpoint URL** | HTTP only | must speak Streamable HTTP at that path, e.g. `https://mcp.context7.com/mcp` |
| **Headers** | HTTP only | key/value rows, sent on every request. Same `env:NAME` support |
| **Call timeout (ms)** | no | per tool call; digits only. Leave empty for the client default |
| **Invocation** | yes | `Auto` or `Manual` for the new server |

The new server is created with scope *all sessions*; change it from the card afterwards.

Empty-input rule when **editing**: a secret field that shows its masked value and is left untouched sends nothing and keeps the stored value. Typing a new value replaces it. `env:NAME` is stored verbatim and stays "external" in the UI.

### Import JSON

The **Import JSON** tab accepts a document and shows a preview before creating anything.

Accepted shapes:

```jsonc
// 1. Claude Desktop / Cursor
{ "mcpServers": { "<name>": { "command": "…", "args": ["…"], "env": { "K": "V" } } } }

// 2. VS Code
{ "servers": { "<name>": { "type": "stdio" | "http", "command": "…" | "url": "…", "headers": {} } } }

// 3. One server, flat
{ "command": "…", "args": ["…"] }        // or
{ "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }
```

Rules the Host applies:

- The server name comes from the group key, or from `serverName` / `name` / `id` for a flat object. It is slugified to `[A-Za-z0-9_-]` and must be 1–32 characters.
- `transport` is honored; `http` and `streamable_http` both mean `streamable-http`; `sse` is converted to `streamable-http` with a warning, because the shipped client does not speak SSE.
- Without a transport, a `url` means `streamable-http` and a `command` means `stdio`.
- `env` and `headers` accept an object, or a text block of `KEY=value` / `KEY: value` lines.
- Unknown fields are ignored. A candidate with errors is shown in the preview and blocks **Create all**; nothing is created until every candidate is valid.
- Servers are created one after another. If one fails (for example a duplicate name), the action fails and reports the error; the ones created before it stay.

#### Worked example — Claude Desktop

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/data"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "env:GITHUB_TOKEN" }
    }
  }
}
```

Preview shows two candidates: `filesystem` (stdio) and `github` (stdio). Note the `env:GITHUB_TOKEN` value — that server will read the token from the Host process environment at launch, so the secret never lands in `state.json`.

#### Worked example — VS Code

```json
{
  "servers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    },
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": { "Authorization": "Bearer env:LINEAR_API_KEY" }
    }
  }
}
```

`type: "http"` becomes `streamable-http`. A header value may be an `env:NAME` reference only if the whole value is the reference — `"Bearer env:LINEAR_API_KEY"` is stored literally, so put the scheme in your own environment variable or paste the token.

#### Worked example — one server, flat

```json
{
  "name": "demo-2",
  "command": "node",
  "args": ["C:/Users/you/dsh-mcp/demo/demo-server.mjs"]
}
```

A flat object with no `mcpServers`/`servers` group is treated as a single server named `demo-2` (the name is required in practice: without `serverName`/`name`/`id` the name falls back to `server`, which collides as soon as you do it twice).

### Quick add from the marketplace

**Quick add** opens the same drawer in a third mode: the name, transport, command/URL and any `env`/`headers` come from the catalog entry, and the entry's `fields` become inputs.

| Element | Meaning |
|---|---|
| Entry summary | one-paragraph description of what you are adding |
| Requirement badges | same evaluation as the card, plus `Missing` on unmet hard requirements |
| **Add anyway** checkbox | appears only when a hard requirement is unmet; creation is blocked until it is ticked |
| Field inputs | one per `fields[]` entry; `secret: true` renders a password input. Required fields must be filled |
| Placeholders | the catalog's example value, e.g. `C:\Users\me\projects` |

The values you type are substituted into the entry's `command`, `args`, `env` and `headers` wherever `${KEY}` appears, then the server is created exactly as if you had typed the form yourself. Fields are not stored as a template: the substituted values go into the connection config, so re-adding the same entry asks again.

## Editing a server

**Edit** opens the drawer in edit mode: same fields as the manual form, name locked, plus the fact that secret fields show their masked value. Only changed fields are submitted:

- Connection fields (transport, command, args, cwd, url, env, headers, timeout) cause a **rebuild**: the generated bundle is rewritten and reinstalled, and the card goes `updating` → `ready`/`no tools`.
- Mode and labels (title, description) are applied without a reconnect.
- Scope is edited on the card, not in the drawer.
- For `external` servers, only title, description, mode and scope are accepted; anything else is rejected by the Host.

## Scope

A server is *in scope* for a session when:

| Kind | Condition |
|---|---|
| `all` | always |
| `workspace` | the session belongs to one of the selected workspaces (per the workspace registry), **or** the session's `cwd` is the workspace path or below it (case-insensitive, path-resolved) |
| `session` | the session id is in the selected list |

Two details that matter in practice:

- A `workspace` scope with **no** workspace selected behaves like `all` — an empty selection is not a lock-out.
- Scope is evaluated per agent as it runs, so changing it takes effect for sessions that already exist. There is no "reconnect" step.

**What the model sees.** In scope and in `auto` mode, the session's tool list contains `mcp__<id>__<tool>` for every discovered tool. Out of scope, or in `manual` mode, or disabled, those tools are absent from the list *and* execution is refused with `MCP server "<id>" is not available in this session (disabled, out of scope, or command-only)`. The shared resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) are guarded the same way, by their `server` argument.

Slash commands, the Invoke tab and `mcp_manager` are **not** subject to agent scope: they run in the Host, on your behalf, which is exactly why they work for a manual-mode or out-of-scope server.

## Automatic vs manual invocation

| | `auto` | `manual` |
|---|---|---|
| Model tool list | includes the server's tools | excludes them |
| Who can run them | the model, `/mcp call`, the console, `mcp_manager` | `/mcp call`, the console, `mcp_manager` only |
| Good for | servers you trust the model to choose | expensive, destructive, or noisy tools; secrets you want to spend deliberately |

Manual is not a safety sandbox — it is a visibility switch. The tool is still executable through the three Host paths above.

## Invoke tab

The tab has three blocks:

1. Two explainer cards: what *automatic* and *command / manual* invocation mean.
2. **Manual console** — pick a **Server** (only servers with at least one tool are listed), pick a **Tool**, edit the **Arguments (JSON)** textarea (starts at `{}`, with the tool's parameter schema as a hint), press **Run**. The result is rendered as JSON; `Copy` puts it on the clipboard. A tool error is rendered in the error style rather than as a failed page action.
3. **Command reference** — nine ready-to-copy `/mcp` lines. The composer is the real entry point; this block exists so you do not have to remember the syntax.

The console bypasses the model entirely: it calls through the Host's own tool pipeline, so it is the fastest way to check whether a server actually works before wiring it into a workflow.

## `/mcp` command reference

Type these in the composer. Every subcommand is case-insensitive; the tool argument accepts a raw name (`echo`), `server.tool`, or a full `mcp__server__tool`.

| Command | Syntax | What it does | Example |
|---|---|---|---|
| `list` | `/mcp list` | one line per server: `● id [transport] mode=… scope=… tools=N` (plus `error=…` when relevant) | `/mcp list` |
| `tools` | `/mcp tools [server]` | without an argument: `server: tool1, tool2` per server. With one: `mcp__server__tool — description` per tool | `/mcp tools demo` |
| `call` | `/mcp call <server> <tool> [json]` | runs one tool; returns its text content, or its JSON value when the tool returns no text blocks | `/mcp call demo echo {"text":"hi"}` |
| `add` | `/mcp add <name> <json>` | creates a server from a `{command,args,env}` / `{url,headers}` object, with the same validation as the import drawer | `/mcp add time {"command":"uvx","args":["mcp-server-time"]}` |
| `rm` | `/mcp rm <server>` (alias `remove`) | deletes the server and its generated bundle | `/mcp rm time` |
| `enable` | `/mcp enable <server>` | installs/enables the row; prints the resulting summary line | `/mcp enable demo` |
| `disable` | `/mcp disable <server>` | disables the row; the tools disappear from every session | `/mcp disable demo` |
| `auto` | `/mcp auto <server>` | tools become visible to the model (creates no connection change) | `/mcp auto demo` |
| `manual` | `/mcp manual <server>` | tools are hidden from the model | `/mcp manual demo` |
| `scope` | `/mcp scope <server> <all\|workspace\|session> [ids…]` | sets the scope; `all` clears the id lists | `/mcp scope demo session 3f8c…` |
| `test` | `/mcp test <server> [tool] [json]` | without a tool: lists tools plus row phase. With one: calls it and prints the JSON result | `/mcp test demo add {"a":2,"b":3}` |
| `market` | `/mcp market [query]` | lists catalog entries (`id — title (transport[, needs API key])`), filtered by a case-insensitive substring | `/mcp market github` |
| *(none)* | `/mcp` or `/mcp help` | prints the built-in help list | `/mcp` |

Errors are returned as text, not exceptions: unknown server, unknown tool, invalid JSON arguments, or a failed tool call all come back as an `error` result with the reason.

`/mcp test` is implemented but is **not** listed in the built-in help text or in the panel's command cheat-sheet — it works, it is just not advertised.

## `mcp_manager` reference

The model-side tool. All actions return JSON; results render as pretty-printed text.

| Action | Arguments | Returns |
|---|---|---|
| `list` | — | `servers[]` with `id`, `title`, `transport`, `enabled`, `mode`, `scope`, `toolCount`, `status` |
| `tools` | — | `tools`: `{ "<server>": ["mcp__…", …] }` |
| `market` | `query?` | `entries[]` with `id`, `title`, `transport`, `auth`, `requirements`, `fields` |
| `add` | `config` (one server, or an `mcpServers`/`servers` document) | `ok`, `servers: ["<id>", …]`, or `errors[]` |
| `update` | `id`, `patch` | the updated server view |
| `remove` | `id` | `{ id, removed: true }` |
| `toggle` | `id`, `enabled` | the server view |
| `test` | `id`, `tool?`, `arguments?` | tool list (no `tool`), or the call result |
| `call` | `id`, `tool`, `arguments?` | `{ isError, value, content, error }` |

Example:

```json
{"action":"add","config":{"command":"node","args":["C:/tools/my-mcp.mjs"]}}
```

```json
{"action":"call","id":"demo","tool":"echo","arguments":{"text":"hello from the model"}}
```

`mcp_manager` is itself an ordinary tool: it stays available in `manual` mode and for out-of-scope servers, which is what makes it the escape hatch for a deliberately hidden server.

## Testing a server

Three ways, increasingly assertive:

| Level | How | What it proves |
|---|---|---|
| Card status | look at the dot | installation, activation and tool discovery all succeeded |
| **Test** on the card | lists tools and the row's `enabled`/`fiberPhase` | the client can talk to the server right now |
| **Test** with a tool | `/mcp test <server> <tool> {…}` or `mcp_manager {"action":"test","id":…,"tool":…}` | the call path works end to end, including credentials |

For `stdio` servers, a failure here usually means the command is not on `PATH`, the package download failed, or the process exits immediately — run the same command in a terminal to see its stderr. For HTTP servers, a `401`/`403` means the header name or token scheme is wrong, or the endpoint wants an OAuth flow the client does not implement.

## MCP resources

The shipped MCP client registers three shared tools for resources — `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` — which take a `server` argument. MCP Center guards them by scope and mode exactly like the namespaced tools: a `read_mcp_resource` call naming a disabled, out-of-scope or `manual` server is rejected.

There is no resource browser in the panel: resources are a model-facing surface. The bundled demo server exposes two (`demo://readme`, `demo://env`) if you want to see the flow with a server that needs nothing.

Note that `/mcp call` and `mcp_manager {"action":"call"}` address tools *within* a server namespace (`mcp__<server>__…`), so they cannot reach the global resource tools; those are only callable by the model, inside a session where the server is in scope.
