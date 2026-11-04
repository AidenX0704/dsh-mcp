# dsh-mcp-center

把 DeepSeek Harness 里所有 MCP 服务器集中到一页管理：浏览内置市场、手动填写或直接粘贴 `mcpServers` 配置、按「全部会话 / 指定工作区 / 指定会话」限定范围，并选择自动调用或斜杠命令手动调用。

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)
![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc-blueviolet.svg)
![tests](https://img.shields.io/badge/tests-offline%20suite%20passing-brightgreen.svg)
[![ci](https://github.com/AidenX0704/dsh-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AidenX0704/dsh-mcp/actions/workflows/ci.yml)

`license` / `node` / `dsh` / `tests` 四个是 shields.io 的静态徽章，不是在线服务；`ci` 徽章对应 `.github/workflows/ci.yml`，只有该工作流跑过之后才会显示状态。

## 功能概览

- **侧栏入口 `mcp`**（order 40，排在「插件 / 自动化任务 / 技能中心」之后），在主栏渲染 MCP 管理页。
- **三个页签**：*已配置*（状态、命令或地址、工具数、生效范围、调用方式，以及启停 / 编辑 / 测试 / 展开 / 删除）、*市场*、*调用*。
- **市场**内置 19 个真实 MCP 服务器和 1 个离线演示服务器：分类筛选、搜索、前置条件标签（密钥 / OAuth / Node / Python / uv / Docker / 网络），快捷添加弹窗由条目的 `fields` 自动生成。
- **两种添加方式**：手动表单（stdio 或 streamable-http、命令、参数、环境变量、地址、请求头、超时）与 JSON 导入（支持 Claude Desktop / Cursor 的 `mcpServers`、VS Code 的 `servers`，或单个 `{command}` / `{url}` 对象，可一次导入多台），创建前先给解析预览。
- **生效范围**：全部会话、指定工作区、指定会话。超出范围的服务器不只是「建议别用」——它的工具会从该会话的工具表里移除，执行时也会被拒绝。
- **调用方式**：`auto` 把工具放进模型的工具列表；`manual` 对模型隐藏，只能通过 `/mcp call`、调用台或 `mcp_manager` 工具执行。
- **模型侧控制**：`mcp_manager` 工具（`list`、`tools`、`market`、`add`、`update`、`remove`、`toggle`、`test`、`call`）与 `/mcp` 命令，和页面共用同一套 Host 操作。

## 安装

本插件是一个 DSH bundle，可以用 DSH 支持的任意 spec 安装（npm 包名、绝对路径、git 地址、`.tgz` 地址）。

**方式一：插件页面（Web GUI）** —— 侧栏 **插件 / Plugins** → 安装 → 粘贴仓库地址：

```
https://github.com/AidenX0704/dsh-mcp
```

安装后按 **F5** 刷新页面：Client 半在页面启动时加载，不刷新看不到侧栏入口。

**方式二：Agent 工具调用**（需要 `danger-full-access` 会话）：

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp"}
```

`github:AidenX0704/dsh-mcp` 这种简写形式同样可用。

**方式三：锁定发布 tag**（任意 git ref 或 commit 都可以）：

```
https://github.com/AidenX0704/dsh-mcp#v0.1.0
```

**4. npm registry。** 该包以 `dsh-mcp-center-ui` 发布：npm 上裸名 `dsh-mcp-center` 属于另一个无关项目，因此这里加了 `-ui` 后缀：

```json
{"action":"install_bundle","target":"dsh-mcp-center-ui"}
```

其余方式——本地开发目录（`link:`）、`npm pack` 打出的 tarball、registry——以及它们各自在 profile `package.json` 里留下什么记录，见 [docs/install.md](docs/install.md)。

## 快速开始

1. 按上面任选一种方式安装，然后刷新页面（F5）。
2. 打开侧栏 **MCP** → **市场**页签。
3. 找到 **本地演示服务器**（`demo`，分类「本地内置」）——不需要网络、不需要 `npx`、不需要密钥——点 **快捷添加** → **创建**。
4. 回到 **已配置**，卡片变为正常状态并显示 4 个工具：`echo`、`add`、`now`、`list_dir`。
5. 切到 **调用**，选 `demo`、选 `echo`，参数改成 `{"text":"hello"}`，点 **运行**。

在输入框里等价的一次调用：

```
/mcp call demo echo {"text":"hello"}
```

## 使用

### 页签与控件

| 页签 | 内容 |
|---|---|
| 已配置 | 每个服务器一张卡片：状态灯、连接方式标签、调用方式标签、命令与参数或地址、工具数、范围摘要、状态信息。行内操作：启停开关、**范围**、**测试**、**编辑**、**详情**（工具列表 + 调用方式切换）、删除（两步确认）。顶部有「已配置 / 已启用 / 工具数」统计。 |
| 市场 | 搜索框、分类标签、每个条目一张卡片：标题、id、简介、连接方式、鉴权标签、前置条件标签、`核对于 <日期>`、**文档**链接、**快捷添加**。 |
| 调用 | 服务器下拉（只列有工具的服务器）、工具下拉、JSON 参数、**运行**、结果**复制**，以及带逐行复制按钮的 `/mcp` 命令速查。 |

逐控件说明见 [docs/usage.md](docs/usage.md)。

### 生效范围

| 范围 | 模型能看到这些工具的条件 |
|---|---|
| 全部会话 | 总是可见 |
| 指定工作区 | 会话属于所选工作区之一，或其工作目录位于所选工作区路径之下 |
| 指定会话 | 会话 id 在所选列表里 |

超出范围的服务器会被拦两次：`mcp__<server>__*` 从该会话的工具表里移除；任何执行尝试（包括按 `server` 参数寻址的共享工具 `list_mcp_resources` / `read_mcp_resource`）都会被拒绝。

### 自动与手动

| 调用方式 | 模型工具表 | 工具的运行方式 |
|---|---|---|
| `auto` | 含 `mcp__<server>__*`（受范围约束） | 模型可直接调用；`/mcp call` 与调用台仍然可用 |
| `manual` | 不含这些工具 | 只能用 `/mcp call`、调用台或 `mcp_manager {"action":"call"}` |

### `/mcp` 命令

| 命令 | 作用 |
|---|---|
| `/mcp list` | 列出所有服务器及其调用方式、范围、工具数 |
| `/mcp tools [server]` | 已发现的工具名（全部或指定服务器） |
| `/mcp call <server> <tool> [json]` | 手动执行一个工具 |
| `/mcp add <name> <json>` | 用一段连接配置创建服务器 |
| `/mcp rm <server>` | 删除服务器及其生成的 bundle |
| `/mcp enable <server>` / `/mcp disable <server>` | 启用 / 停用 |
| `/mcp auto <server>` / `/mcp manual <server>` | 切换调用方式 |
| `/mcp scope <server> <all\|workspace\|session> [ids…]` | 设置范围 |
| `/mcp test <server> [tool] [json]` | 列出该服务器的工具，或调用其中一个 |
| `/mcp market [query]` | 浏览内置市场目录 |
| `/mcp`（不带参数） | 输出与内置帮助相同的列表 |

### `mcp_manager` 工具

| 参数 | 用于 | 含义 |
|---|---|---|
| `action`（必填） | 全部 | `list`、`tools`、`market`、`add`、`update`、`remove`、`toggle`、`test`、`call` |
| `id` | update / remove / toggle / test / call | 目标服务器 id |
| `config` | add | 单台服务器 `{command,args,env}` / `{url,headers}`，或 `{mcpServers:{…}}` / `{servers:{…}}` 文档 |
| `patch` | update | 可改字段：title、description、transport、command、args、env、cwd、url、headers、mode、scope、enabled |
| `enabled` | toggle | 目标启停状态 |
| `tool` | test / call | 原始工具名，或完整的 `mcp__server__tool` |
| `arguments` | test / call | 工具的 JSON 参数 |
| `query` | market | 自由文本过滤 |

## 安全与数据

- **只走回环地址。** 页面通过 Web GUI 自身端口上的 `/api/dsh-mcp-center` 访问 Host；非回环地址的请求一律返回 `403`，除非插件配置里设了 `allowRemote: true` 且调用方是已配对的远设备。
- **密钥留在 Host。** 所有响应里的 `env` / `headers` 值都做掩码（`••••`，或前 3 位 + `••••` + 后 2 位）。页面永远拿不到已存的密钥；编辑时未改动的字段留空提交，Host 保留原值。
- **`env:NAME` 间接引用。** 不想把 token 写进配置，就把值写成 `env:GITHUB_TOKEN`。生成的 bundle 里得到的是实时的 `process.env.GITHUB_TOKEN` 引用，密钥不会进入 `state.json`。
- **落盘状态。** `$DSH_HOME/mcp-center/state.json`（默认 `~/.dsh`）以 `0600` 权限写入——因为它可能含 API key。Windows 上实际权限取决于目录 ACL，请同样按敏感文件对待。
- **完整 Host 权限。** 这是普通的进程内 DSH 插件：和其他 bundle 行一样运行在 Host 内，能启动你配置的 `stdio` 进程，也能读到 Host 进程的环境变量。只添加你信任的服务器，添加前看一眼市场条目里的 `command`。

完整字段与规则见 [docs/configuration.md](docs/configuration.md)。

## 兼容性

| 要求 | 值 |
|---|---|
| DSH 运行时 | `>=0.2.0-rc`（在 0.2.1-rc.5 / 桌面端 44.7.0 上验证） |
| Node.js | `>=22`（`stdio` 服务器由 Host 自己的运行时启动） |
| 浏览器 | Harness Web GUI；Client 半在页面启动时加载 |
| 外部工具 | `stdio` 市场条目需要 `npx` / `uvx` / `docker` 在 `PATH` 上，首次运行还需要联网 |

MCP 协议本身不在本插件里实现：握手、工具调用、资源读取全部交给随 Harness 附带的 `@deepseek-ai/dsh-mcp-client`，本插件只负责为它生成配置。

## 更新与卸载

覆盖安装会返回 `already-installed`。受支持的更新方式是先删再装：

```json
{"action":"remove_bundle","target":"dsh-mcp-center-ui"}
```

```json
{"action":"install_bundle","target":"https://github.com/AidenX0704/dsh-mcp#vX.Y.Z"}
```

插件页面提供同样的移除 / 安装按钮。变更返回 `restart-required` 时重启 DSH；Client 半的改动刷新页面（F5）即可。卸载会移除插件行和它生成的服务器 bundle，配置仍留在 `$DSH_HOME/mcp-center/`，需要时手动删除。

更新策略、回滚到旧 tag、`link:` 与发布版互相切换：见 [docs/update.md](docs/update.md)。

## 开发

不需要 `npm install`，也没有构建步骤——这个包零运行时依赖。

```bash
npm test                    # 离线：Host 测试、Client 渲染测试、演示服务器自检、MCP stdio 探针
npm run test:host
npm run test:client
npm run test:demo
npm run demo                # 以 stdio 方式运行演示 MCP 服务器

# 对运行中的 GUI 做端到端测试（会创建并删除一个演示服务器）
node test/run.mjs --e2e
DSH_WEB_URL=http://127.0.0.1:3637 node test/e2e-http.mjs
```

用自己的工作副本开发，用绝对路径安装即可——DSH 会记录一条 `link:` 依赖，改动后重建 / 重载生效：

```json
{"action":"install_bundle","target":"C:\\Users\\you\\dsh-mcp"}
```

## 文档

| 页面 | 内容 |
|---|---|
| [docs/install.md](docs/install.md) | 每种安装方式、各自留下什么记录、前置条件、验证步骤、卸载、安装失败对照表 |
| [docs/update.md](docs/update.md) | 更新与回滚策略、`link:` 与发布版互转、版本核验 |
| [docs/usage.md](docs/usage.md) | 完整使用手册：面板控件、市场条目结构、导入格式、范围、调用方式、`/mcp`、`mcp_manager` |
| [docs/configuration.md](docs/configuration.md) | 插件配置键、`state.json` 结构、掩码规则、生成的 bundle、市场数据契约 |
| [docs/architecture.md](docs/architecture.md) | Host / Client 分工、bundle 生成流程、HTTP API 列表、范围与调用方式的落实方式、安全模型 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 现象 → 原因 → 解决，以及诊断信息收集方式 |
| [docs/releasing.md](docs/releasing.md) | 维护者发布清单 |

## 已知限制

- **面板里删不掉已保存的密钥。** 编辑弹窗里清空某个键值行会被当成「不修改」（`""` 表示保持原值）。Host 接口本身支持删除：`POST /api/dsh-mcp-center/action`，body 为 `{"action":"update","id":"<server>","patch":{"env":{"KEY":null}}}`。更稳妥的做法是用 `env:NAME` 间接引用，密钥根本不落盘。
- **先删服务器，再卸载插件。** 如果 `dsh-mcp-center` 卸载时 `@dsh-mcp-center/server-<id>` 行还装着，这些服务器仍会通过 `@deepseek-ai/dsh-mcp-client` 加载，但不再受范围与调用方式约束。请先在「已配置」里逐台删除，或到插件页移除残留行。
- **只支持 OAuth 的市场条目没有 OAuth 流程。** Notion、Sentry 只列出了工具面，没配授权会返回 `401`；GitHub、Linear 用的是 PAT 请求头。
- **`state.json` 的 `0600` 在 POSIX 上精确，在 Windows 上只是名义上的**——文件权限实际继承目录 ACL。任何平台都请把它当敏感文件对待。
- **被插件「接管」的外部服务器在编辑表单里一律显示 `streamable-http`**，因为从外部只能看到工具命名空间，看不到真实传输方式。

## 参与贡献

问题反馈、市场条目修正与 PR 请见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © AidenX0704
