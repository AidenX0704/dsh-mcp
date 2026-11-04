# Configuration and data

What the plugin reads, what it writes, and where. Everything here can be inspected on disk; nothing requires a rebuild.

- [Plugin config](#plugin-config)
- [Where `$DSH_HOME` comes from](#where-dsh_home-comes-from)
- [State file](#state-file)
- [Secret handling](#secret-handling)
- [Generated per-server bundles](#generated-per-server-bundles)
- [Marketplace catalog](#marketplace-catalog)
- [Adding your own marketplace entries](#adding-your-own-marketplace-entries)

## Plugin config

The bundle's `cordis.patch.yml` inserts one Host row:

```yaml
- insert:
    - id: mcp-center
      name: dsh-mcp-center
      config:
        enabled: true
        allowRemote: false
```

The Loader entry id is `include:mcp-center` (patch id `mcp-center`). The row declares no Config schema, so the keys below are read loosely — an unknown key is ignored rather than rejected.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` registers nothing: no HTTP route, no `/mcp` command, no `mcp_manager` tool, no scope enforcement. Useful for temporarily disabling the plugin without uninstalling it. |
| `allowRemote` | boolean | `false` | when `true`, a non-loopback request to the HTTP API is allowed **if** the Web UI pairing service reports the caller as a paired device; when `false`, every non-loopback request gets `403` |
| `dataDir` | string | `$DSH_HOME/mcp-center` | overrides the data directory. Intended for tests (the offline Host harness points it at a temp directory); changing it in a real profile gives you an empty, disconnected MCP Center with no warning |

To change config, edit the row's `config` block in the profile patch layer that owns it (or re-run the plugin's install so the defaults are re-inserted), then let the row re-activate.

## Where `$DSH_HOME` comes from

```
$DSH_HOME  ── set? ── yes → use it
                 └── no  → os.homedir()/.dsh
dataDir = <that>/mcp-center
```

On Windows the default resolves to `C:\Users\<you>\.dsh`; on macOS/Linux to `~/.dsh`. The resolved directory is reported in the `/state` payload (`environment.dataDir`), which is the quickest way to confirm which directory a running instance is using — a mismatch here is the usual reason "my servers disappeared".

Layout:

```
$DSH_HOME/mcp-center/
  state.json                 # the registry; mode 0600
  servers/
    <id>/
      package.json           # @dsh-mcp-center/server-<id>
      cordis.patch.yml       # row mcp-center-<id> → @deepseek-ai/dsh-mcp-client
```

## State file

`state.json` is the single source of truth for the plugin. It is written atomically (temp file + rename) under a lock, so a crash mid-write cannot leave a truncated file.

```jsonc
{
  "version": 1,
  "servers": {
    "<id>": {
      "id": "demo",
      "title": "demo",                 // display name
      "description": "",
      "origin": "managed",             // "managed" (created here) | "external" (adopted row)
      "marketId": "demo",              // catalog id, or null
      "transport": "stdio",            // "stdio" | "streamable-http"
      "command": "node",               // stdio
      "args": ["C:/Users/you/dsh-mcp/demo/demo-server.mjs"],
      "env": {},                       // stdio: { "KEY": "value" | "env:NAME" }
      "cwd": null,                     // stdio working directory
      "url": null,                     // streamable-http endpoint
      "headers": {},                   // streamable-http: { "Key": "value" | "env:NAME" }
      "toolCallTimeoutMs": null,       // per-call timeout, null = client default
      "enabled": true,
      "mode": "auto",                  // "auto" | "manual"
      "scope": { "kind": "all", "workspaceIds": [], "sessionIds": [] },
      "revision": 1,                   // bumped on every materialization
      "createdAt": 1793704440840,
      "updatedAt": 1793704447036,
      "status": { "phase": "ready", "message": "", "updatedAt": 1793704442282 },
      "tools": [],                     // discovered tools (derived, rewritten on scan)
      "lastSeenAt": 1793756640838      // derived
    }
  },
  "settings": {
    "marketplaceInstalled": {}
  }
}
```

Notes:

- `servers` is an **object keyed by server id**, not an array. The key and the `id` field are kept identical.
- `tools` and `lastSeenAt` are derived: they are refreshed from the live tool registry every few seconds and are safe to ignore (or to see stale in a file copied from another machine).
- `status.phase` values: `idle`, `installing`, `starting`, `ready`, `pending`, `updating`, `error`.
- On load the plugin normalizes old shapes: a missing `scope` becomes `{kind:"all"}`, a missing `status` becomes `{phase:"idle"}`, non-array `args` become `[]`, and non-object `env`/`headers` become `{}`. Hand-editing the file is survivable, but stop the plugin first — the running instance rewrites it from memory.
- Missing file (`ENOENT`) is not an error: the plugin starts with an empty registry.

### Permissions

The file is written with `mode: 0o600` because it may hold API keys. On Windows the effective access is inherited from the directory's ACL rather than a POSIX mode bit — `git bash` will show something like `644` for a file the plugin asked to create `0600`. Treat `$DSH_HOME/mcp-center/` as sensitive either way: back it up encrypted, do not commit it, do not sync it to a shared folder.

## Secret handling

Two different levels, and the difference matters:

| Where | What is stored | Protected by |
|---|---|---|
| `env:NAME` reference | the literal string `env:NAME` in `state.json` **and** in the generated patch | nothing on disk — the value is never written anywhere; it is read from the Host process environment when the MCP client starts |
| Inline value | the plaintext value in `state.json` **and** in the generated `cordis.patch.yml` of that server's bundle | the `0600` state file (POSIX) and the data directory ACL (Windows) only |

So `env:NAME` is the only form that keeps a secret out of the data directory. Use it for anything long-lived:

```json
{ "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "env:GITHUB_TOKEN" } }
```

The name must be a valid identifier (`[A-Za-z_][A-Za-z0-9_]*`); the generator emits `!!js process.env.GITHUB_TOKEN` into the YAML, so the value is resolved inside the Host at load time. Same rule for HTTP `headers`.

**Masking.** Every value that leaves the Host is masked by `maskValue`:

| Stored value | Returned as |
|---|---|
| `env:NAME` | the reference itself, with `external: true` (so it is obvious there is no secret to reveal) |
| 8 characters or fewer | `••••` |
| longer | first 3 + `••••` + last 2, e.g. `ghp••••ab` |
| empty / missing | `set: false` |

The page therefore never receives a secret, and the edit form cannot round-trip one: an untouched secret field is submitted empty, which the Host interprets as "keep the stored value" (`""` = keep, `null` = delete, anything else = replace).

**Known gap:** the panel's key/value editor can add and replace values but has no way to send the `null` that deletes one, so a stored key cannot be removed from the UI. Delete it through the API instead:

```bash
curl -X POST http://127.0.0.1:6922/api/dsh-mcp-center/action \
  -H 'content-type: application/json' \
  -d '{"action":"update","id":"github","patch":{"env":{"OLD_KEY":null}}}'
```

## Generated per-server bundles

The plugin never writes the profile patch or the profile `package.json`. For each configured server it writes a tiny **config-only bundle** and hands it to the profile Plugin Manager (`ctx.pluginManager.installBundle`), so rows, enablement, HMR and uninstall behave like any other plugin.

```
$DSH_HOME/mcp-center/servers/<id>/package.json
$DSH_HOME/mcp-center/servers/<id>/cordis.patch.yml
```

`package.json`:

```json
{
  "name": "@dsh-mcp-center/server-<id>",
  "version": "0.1.<revision>",
  "private": true,
  "type": "module",
  "description": "MCP Center server \"<id>\" (generated; edit it from the MCP Center page)",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: "mcp-center-<id>"
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: "<id>"
        transport: "streamable-http"      # or "stdio"
        failOnStartupError: false
        url: "https://…/mcp"              # or command/args/cwd/env
```

| Thing | Value |
|---|---|
| bundle package name | `@dsh-mcp-center/server-<id>` |
| Loader row id | `mcp-center-<id>` |
| tool prefix | `mcp__<id>__` |
| bundle version | `0.1.<revision>` — `revision` increments every time the bundle is materialized, so a reinstall is a genuinely new package version |

The profile's `dependencies` will show these as `link:<abs path>` entries and `dsh.profile.bundles` will list them: that is the Plugin Manager's record, not something to hand-edit. Editing a connection field in the UI bumps `revision`, rewrites both files, and reinstalls the bundle; deleting the server removes both the bundle and its directory.

`failOnStartupError: false` is deliberate: a server that cannot start must not take the session down — it shows up as `error` / `no tools` on its card instead.

## Marketplace catalog

`data/marketplace.json` is shipped with the package and cached in memory on first read. It is static, curated and versioned — the Marketplace tab needs no network.

Top-level shape:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-11-03",
  "categories": [ { "id": "official", "title": { "zh": "官方参考", "en": "Official reference" } } ],
  "servers": [ /* entries */ ]
}
```

Each entry: `id` (also the server name), bilingual `title`/`summary`, `category`, `transport`, `command`/`args`/`env` (stdio) or `url`/`headers` (http), `fields[]` (the `${KEY}` inputs the quick-add dialog generates), `requirements[]` (`kind` + `hard` + bilingual `detail`), `auth`, `docs`, `homepage`, `tags`, `verifiedAt`, `notes`.

The Host adds one entry that is not in the file: the built-in **demo** server (`id: demo`, transport `stdio`, `command: node`, `args: [<package>/demo/demo-server.mjs]`), plus a `local` category, because it needs nothing from the machine and therefore makes a working first connection.

Full field-by-field contract, requirement kinds and the accuracy rules the catalog is held to: [data/MARKETPLACE-SPEC.md](../data/MARKETPLACE-SPEC.md).

## Adding your own marketplace entries

The catalog is a plain JSON file — the practical way to add your own servers is to keep a private fork or a local copy:

1. Edit `data/marketplace.json`, appending to `servers[]`. Copy an existing entry and change it; the shape must satisfy the spec, not just look plausible.
2. Keep `id` unique, lowercase, `[a-z0-9-]` — it becomes the server name and therefore the tool prefix.
3. If the entry needs user input, declare it in `fields[]` and reference it as `${KEY}` in `command`, `args`, `env` or `headers`. Only declared keys are substituted; an undeclared `${KEY}` stays literal.
4. Put machine requirements in `requirements[]` so the badges are honest. `hard: true` (default) blocks quick add until acknowledged; `hard: false` is informational.
5. Set `verifiedAt` to the date you actually confirmed the command or URL — it is rendered in the UI.
6. Restart the Host row (or DSH). The catalog is read once and cached for the life of the plugin instance, so editing the file has no effect until it reloads.

If you install this package from a `link:` checkout, your edited catalog is what runs. If you installed from a tag or a registry, edits to `data/marketplace.json` under `$DSH_HOME` will not help — the file is read from the **installed package directory**, not from the data directory.
