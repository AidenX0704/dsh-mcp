# Security policy

## Supported versions

Only the current `0.1.x` line receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ |
| < 0.1   | ❌ |

## Reporting a vulnerability

Please report privately through GitHub Security Advisories:

<https://github.com/AidenX0704/dsh-mcp/security/advisories/new>

Do **not** open a public issue for a vulnerability, and do not paste live API keys,
tokens or header values into an issue, a PR or a screenshot.

A useful report includes:

- the plugin version (Plugins page or `package.json`), the DeepSeek Harness version,
  and your OS + Node.js version;
- the smallest reproduction you can manage (which server entry, which scope and
  invocation mode, which `/mcp` subcommand, or which `plugin_manager` action);
- what an attacker gains that they did not have before — this plugin runs inside the
  Harness process, so "already able to run code in the Host" is not a boundary crossing.

This is a single-maintainer project: reports are handled on a best-effort basis, without
a fixed response SLA. If a fix is needed you will get an advisory, a patched release,
and credit in the advisory unless you ask to stay anonymous.

## Threat model

What this plugin actually is, in terms of trust:

- **It runs in-process in the Host with full privileges.** `index.js` is a normal
  Harness/Cordis plugin row. It runs as your user, with your filesystem and network
  access, and no sandbox of its own. Any bug here is a bug in the Host's privilege domain.
- **It stores MCP server secrets on disk.** Credentials you type into a server entry
  (API keys, header values, tokens) are written to `$DSH_HOME/mcp-center/state.json`
  (`DSH_HOME` defaults to `~/.dsh`), created with mode `0600`. Values are stored in
  plain text unless you use `env:NAME` indirection, which keeps the secret in the Host
  process environment instead of the state file. Treat that file as a secret store:
  back it up deliberately, never commit it, and prefer `env:NAME` on shared machines.
- **Its HTTP API is loopback-only by default.** The Client half talks to
  `/api/dsh-mcp-center`; requests that do not arrive from `127.0.0.1` / `::1` are refused.
  The one exception is deliberate and off by default: `cordis.patch.yml` ships
  `allowRemote: false`, and only if you turn it on are requests from *paired* Remote Web UI
  devices accepted (through the Host's `remoteWebUiPairing` service). Either way there is no
  credential beyond "came over loopback" or "is a paired device", so anything able to make
  such requests from your machine can drive the API.
- **Responses are masked.** The public server view replaces stored `env` and `headers`
  values with masked strings (`env:NAME` references are shown as external references,
  never resolved). The masking protects the UI and copied diagnostics; it is not
  encryption at rest.
- **It installs spawned MCP servers that execute arbitrary local commands.** Each
  configured server materializes as a generated bundle in
  `$DSH_HOME/mcp-center/servers/<id>/` and is installed through the profile Plugin Manager;
  the command it launches (`npx …`, `uvx …`, a local binary, a docker image, or a remote
  URL) then runs with your privileges. **Marketplace entries are therefore code you are
  trusting.** The curated catalog only records commands taken from each vendor's
  current documentation, with a `verifiedAt` date — that is a provenance signal, not an
  audit. Read what you add before you add it.
- **Scope and invocation mode are about exposure, not isolation.** `all` / `workspace` /
  `session` and `auto` / `manual` decide which sessions see which `mcp__<server>__*`
  tools, enforced with the Host's tool-restriction mechanism. They keep a server out of
  the wrong conversation; they do not sandbox the server process.

## Non-goals

Out of scope by design, and not treated as vulnerabilities:

- encrypting `state.json` or otherwise protecting it from a user who can already read
  your home directory;
- sandboxing or auditing the third-party MCP servers you choose to install;
- authenticating the loopback HTTP API, or adding a stronger scheme than the existing
  loopback check and the opt-in `allowRemote` device pairing;
- multi-user isolation inside one Host process;
- an OAuth broker for OAuth-only catalog entries (they connect but their upstream
  server may still answer 401 without your own token);
- defending against other plugins already running in the same Host process — they can
  call the same services directly.
