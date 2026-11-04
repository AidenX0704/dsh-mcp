# MCP Center marketplace catalog — data contract

`marketplace.json` is bundled with the plugin and rendered in the **市场 / Marketplace** tab.
No network access is needed at runtime: the catalog is static, curated, and versioned.

Everything user-visible is bilingual (`zh` + `en`). Keep `en` first-class; the app runs in
either locale.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-11-03",
  "categories": [
    { "id": "official", "title": { "zh": "官方参考", "en": "Official reference" } }
  ],
  "servers": [
    {
      "id": "filesystem",                       // stable, [a-z0-9-], unique; also becomes serverName
      "title": { "zh": "文件系统", "en": "Filesystem" },
      "summary": { "zh": "读写本机目录…", "en": "Read and write local directories…" },
      "category": "official",                   // one of categories[].id
      "transport": "stdio",                     // "stdio" | "streamable-http"
      "command": "npx",                         // stdio only
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${DIR}"],
      "url": null,                              // streamable-http only, e.g. "https://mcp.context7.com/mcp"
      "env": {},                                // stdio: extra env, values may use ${KEY}
      "headers": {},                            // http: extra headers, values may use ${KEY}
      "fields": [                               // user inputs; ${KEY} is replaced everywhere above
        {
          "key": "DIR",
          "label": { "zh": "允许访问的目录", "en": "Allowed directory" },
          "hint": { "zh": "服务器只能访问这个目录及其子目录", "en": "The server can only access this directory and below" },
          "placeholder": "C:\\Users\\me\\projects",
          "secret": false,
          "required": true,
          "default": ""
        }
      ],
      "requirements": [                         // shown as badges; hard ones block "quick add"
        { "kind": "node", "hard": true, "detail": { "zh": "需要 Node.js 20+", "en": "Requires Node.js 20+" } }
      ],
      "auth": "none",                           // "none" | "api-key" | "oauth" | "local-token"
      "docs": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
      "homepage": "https://github.com/modelcontextprotocol/servers",
      "tags": ["files", "local"],
      "verifiedAt": "2026-11-03",               // date the command/url was last confirmed
      "notes": { "zh": "", "en": "" }           // optional caveats (deprecation, cost, network)
    }
  ]
}
```

## Requirement kinds

`requirements[].kind` is one of:

| kind | meaning | how the UI checks it |
|---|---|---|
| `node` | needs a Node.js runtime (npx packages) | host reports `node` version |
| `python` | needs Python 3 | host reports `python` |
| `uv` | needs `uv` / `uvx` | host reports `uv` |
| `docker` | needs a running Docker daemon | host reports `docker` |
| `api-key` | needs a secret/token from the user | `fields` with `secret: true` |
| `oauth` | authorization happens in a browser on first use | informational |
| `network` | needs outbound internet access | informational |
| `os` | restricted to one OS | informational (put the OS in `detail`) |

Requirements are advisory UI; `hard: true` means the quick-add button is disabled until the
user confirms. Always be truthful: if a server is archived, deprecated, or only runnable from
source, say so in `notes` and prefer a maintained alternative.

## Accuracy rules (non-negotiable)

1. Every `command`, package name, `args` default, and `url` must be copied from the server's
   current official documentation, Quickstart, or README — not from memory.
2. If a package was renamed, archived, or replaced, list the **maintained** one and mention the
   old one in `notes`. Do not resell an archived package as current.
3. Prefer, in this order: official reference server → first-party vendor MCP endpoint/served
   package → well-known community server with an active repo.
4. `npx -y <pkg>` entries must really be installable from npm right now; remote `url` entries
   must really speak Streamable HTTP at that path.
5. `verifiedAt` is the date you actually confirmed it. Never copy a date you did not check.
