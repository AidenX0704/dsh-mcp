# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Configuration is a dialog, not a side drawer.** Add, edit, quick-add and JSON import all
  open a centered modal with a sticky footer, an Escape/backdrop close, focus moved into the
  form and Tab kept inside the dialog.
- **Panel restyled against the shipped Harness theme.** Server cards separate identity,
  endpoint and state; the marketplace grid gains per-entry identity marks; the invoke console
  is a two-pane workspace with an inline invocation-mode switch and a collapsible command
  reference. Counts moved from a stat row into the page header.

### Fixed

- **Enable switches read as a solid black pill.** The knob used the primary label colour, so
  it disappeared into the brand track in the light theme. The track now takes
  `--dsw-alias-brand-primary` with a `--dsw-alias-label-primary-foreground` knob, and the off
  state is a neutral track with a primary knob.
- Status, requirement and mode chips lost their tints because `is-brand` is not a theme
  tone; they now use the accent and state tints.

## [0.1.0] - 2026-11-04

First public release: an MCP management centre for DeepSeek Harness, driven equally from
the Web UI, the agent tool and a slash command.

### Added

- **MCP Center panel.** A sidebar entry (order 40, below Plugins, Automations and Skills)
  and a main-column page with three tabs: **Configured**, **Marketplace** and **Invoke**.
- **Curated marketplace.** 19 real MCP servers (official reference servers, vendor
  endpoints, devtools, data, search and infra) plus an offline demo entry, with category
  filter, search, requirement and auth badges, and a quick-add dialog that fills the entry
  from the catalog and asks only for the fields it declares.
- **Manual form and JSON import.** Add servers by hand, or paste/import a Claude Desktop or
  Cursor (`mcpServers`) document, a VS Code (`servers`) document, or a single
  `{command,args,env}` / `{url,headers}` entry — multi-server imports are previewed before
  anything is written.
- **Per-server scope and invocation mode.** Every server carries a scope (`all`,
  `workspace`, `session`) and an invocation mode (`auto` = tools always in the model's tool
  list, `manual` = only through the invoke console or `/mcp`), enforced with tool
  restrictions so the model's list and execution stay aligned.
- **`mcp_manager` agent tool.** The model can list, add, inspect, test, call, enable,
  disable, rescope and remove servers, and read the catalog, without leaving the
  conversation.
- **`/mcp` slash command.** Subcommands `list`, `tools`, `call`, `add`, `rm`, `enable`,
  `disable`, `auto`, `manual`, `scope`, `test` and `market`, sharing the same Host
  operations as the panel.
- **Scope-guarded MCP resource tools.** `list_mcp_resources`,
  `list_mcp_resource_templates` and `read_mcp_resource` respect the same per-server scope,
  so a server that is not visible to a session cannot be read through the shared resource
  tools either.
- **Loopback HTTP API.** `/api/dsh-mcp-center` serves the Client half over loopback only,
  masks stored `env` and `headers` values in every response, and supports `env:NAME`
  indirection so a secret can stay in the process environment instead of `state.json`.
- **Durable state with generated bundles.** Registry state lives in
  `$DSH_HOME/mcp-center/state.json` (mode `0600`), and each configured server materializes
  as its own tiny config-only bundle under `$DSH_HOME/mcp-center/`, installed through the
  profile Plugin Manager so rows, enablement, HMR and uninstall behave like any other
  plugin row.
- **Zero-dependency demo MCP server.** `demo/demo-server.mjs` speaks MCP over stdio with no
  network and no installs, exposing `echo` / `add` / `now` / `list_dir` and two resources,
  and supports `--selftest` for its own protocol checks.
- **Dependency-free MCP probe.** `test/mcp-probe.mjs` performs a real stdio handshake,
  `tools/list` and `tools/call` against any stdio server.
- **Offline test suites.** A Host suite against a mock Cordis context, a Client suite
  against a React stub, the demo server self-test and the probe, all wired into `npm test`
  and runnable without a network, a package download or a running Harness; the live
  end-to-end suite against a running Harness is opt-in.

[Unreleased]: https://github.com/AidenX0704/dsh-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AidenX0704/dsh-mcp/releases/tag/v0.1.0
