/**
 * dsh-mcp-center — Client half.
 *
 * Renders the MCP entry in the sidebar panellist (below Plugins, Automations and
 * Skills) and its page in the main column: the configured servers, the bundled
 * marketplace with quick configurations, and a manual invocation console.
 *
 * The page talks to this package's Host half over the loopback JSON API
 * (`/api/dsh-mcp-center`), the same bridge the shipped plugin pages use. No
 * Harness Client package is imported; React comes from the module table and all
 * styling uses the host theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-center',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-mcp-center'
    const PANEL_ID = 'mcp'
    const PANEL_ORDER = 40
    const API_BASE = '/api/dsh-mcp-center'
    const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

    // -----------------------------------------------------------------------
    // Locale
    // -----------------------------------------------------------------------

    const ZH = {
      title: 'MCP 管理',
      subtitle: '连接外部 MCP 服务器，选择自动调用或命令手动调用，并按范围生效。',
      'tab.configured': '已配置',
      'tab.market': '市场',
      'tab.invoke': '调用',
      'action.refresh': '刷新',
      'action.add': '添加服务器',
      'action.import': '导入 JSON',
      'action.create': '创建',
      'action.cancel': '取消',
      'action.save': '保存',
      'action.edit': '编辑',
      'action.test': '测试',
      'action.details': '详情',
      'action.collapse': '收起',
      'action.copy': '复制',
      'action.copied': '已复制',
      'action.run': '运行',
      'action.preview': '解析预览',
      'action.try': '试运行',
      'action.confirmRemove': '确认删除',
      'state.loading': '正在读取 MCP 配置…',
      'state.empty.title': '还没有配置 MCP 服务器',
      'state.empty.desc': '从市场选一个快捷配置，或手动填写、直接粘贴 JSON。添加后它的工具会出现在模型可用的工具列表里。',
      'state.error': '读取失败',
      'count.configured': '已配置',
      'count.enabled': '已启用',
      'count.tools': '个工具',
      'badge.ready': '已连接',
      'badge.starting': '启动中',
      'badge.pending': '未发现工具',
      'badge.error': '出错',
      'badge.disabled': '已停用',
      'badge.external': '外部配置',
      'badge.auto': '自动调用',
      'badge.manual': '命令调用',
      'badge.stdio': '本地进程',
      'badge.http': '远程 HTTP',
      'scope.all': '全部会话',
      'scope.workspace': '指定工作区',
      'scope.session': '指定会话',
      'scope.label': '生效范围',
      'scope.save': '保存范围',
      'scope.workspaceEmpty': '还没有工作区',
      'scope.sessionEmpty': '还没有活动会话',
      'mode.label': '调用方式',
      'mode.auto': '自动',
      'mode.manual': '手动',
      'mode.autoHint': '模型可以看到并直接调用这些工具',
      'mode.manualHint': '模型看不到这些工具，用 /mcp call 或下方调用台手动运行',
      'form.name': '名称',
      'form.nameHint': '同时作为工具前缀 mcp__<名称>__，1-32 位字母数字与 - _',
      'form.title': '显示名称',
      'form.transport': '连接方式',
      'form.command': '可执行命令',
      'form.commandHint': '例如 npx、node、uvx、docker',
      'form.args': '参数',
      'form.argsHint': '每行一个参数；粘贴的整行会按空格拆分',
      'form.cwd': '工作目录（可选）',
      'form.env': '环境变量',
      'form.envHint': '留空表示保持原值。填写 env:NAME 可引用当前进程环境变量，避免把密钥写进配置。',
      'form.url': '服务地址',
      'form.headers': '请求头',
      'form.timeout': '单次调用超时（毫秒，可选）',
      'form.addRow': '添加一行',
      'form.keyPlaceholder': '名称',
      'form.valuePlaceholder': '值',
      'form.remove': '删除这一行',
      'form.required': '必填',
      'form.keep': '留空保持原值',
      'import.title': '导入 JSON',
      'import.hint': '支持 Claude Desktop / Cursor 的 mcpServers、VS Code 的 servers，以及单个 {command}/{url} 配置。可以一次导入多个。',
      'import.placeholder': '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/data"]\n    }\n  }\n}',
      'import.preview': '解析结果',
      'import.previewEmpty': '先粘贴 JSON 再解析',
      'import.createAll': '全部创建',
      'import.none': '没有解析出可用的服务器',
      'market.search': '搜索服务器、能力或厂商',
      'market.all': '全部',
      'market.add': '快捷添加',
      'market.docs': '文档',
      'market.verified': '核对于',
      'market.needs': '前置条件',
      'market.needsKey': '需要密钥',
      'market.oauth': '需要浏览器授权',
      'market.noAuth': '无需密钥',
      'market.exists': '已配置',
      'market.missing': '缺少',
      'market.forceAdd': '仍然添加',
      'market.fields': '快捷配置',
      'invoke.title': '手动调用台',
      'invoke.desc': '选择服务器和工具，填写 JSON 参数后直接运行；不经过模型，适合调试或手动模式下按需触发。',
      'invoke.server': '服务器',
      'invoke.tool': '工具',
      'invoke.args': '参数（JSON）',
      'invoke.result': '结果',
      'invoke.pickServer': '先选择一个已连接的服务器',
      'invoke.noTools': '这个服务器还没有发现工具',
      'invoke.help': '命令速查',
      'invoke.helpDesc': '在输入框里输入斜杠命令即可，无需打开本页面。',
      'invoke.autoTitle': '自动调用',
      'invoke.autoDesc': '开启后，服务器工具会进入模型的工具列表，模型在需要时自行调用。',
      'invoke.manualTitle': '命令 / 手动调用',
      'invoke.manualDesc': '切到“手动”后工具对模型隐藏，只在你用 /mcp call 或调用台运行时执行。',
      'drawer.create': '添加 MCP 服务器',
      'drawer.edit': '编辑',
      'drawer.manual': '手动配置',
      'drawer.import': '导入 JSON',
      'drawer.marketAdd': '快捷添加',
      'notice.created': '已添加并开始连接',
      'notice.saved': '已保存',
      'notice.removed': '已删除',
      'notice.testOk': '连接正常',
      'notice.testFail': '连接异常',
      'notice.failed': '操作失败',
      'notice.disabled': '已停用',
      'notice.enabled': '已启用',
      'notice.scopeSaved': '生效范围已更新',
      'notice.modeAuto': '已切换为自动调用',
      'notice.modeManual': '已切换为命令调用',
      'notice.loaded': '已刷新',
      'confirm.remove': '删除后会移除它的配置和连接，模型将不再看到这些工具。',
      'error.unknown': '未知错误',
      'tools.empty': '暂无工具',
      'tools.count': '个工具',
      'meta.command': '命令',
      'meta.url': '地址',
      'meta.scope': '范围',
      'meta.mode': '调用',
      'meta.updated': '更新于',
      'footer.host': '配置保存在 Host，密钥不会回传到页面。',
    }

    const EN = {
      title: 'MCP',
      subtitle: 'Connect external MCP servers, choose automatic or slash-command invocation, and scope them per workspace or session.',
      'tab.configured': 'Configured',
      'tab.market': 'Marketplace',
      'tab.invoke': 'Invoke',
      'action.refresh': 'Refresh',
      'action.add': 'Add server',
      'action.import': 'Import JSON',
      'action.create': 'Create',
      'action.cancel': 'Cancel',
      'action.save': 'Save',
      'action.edit': 'Edit',
      'action.test': 'Test',
      'action.details': 'Details',
      'action.collapse': 'Collapse',
      'action.copy': 'Copy',
      'action.copied': 'Copied',
      'action.run': 'Run',
      'action.preview': 'Preview',
      'action.try': 'Try',
      'action.confirmRemove': 'Confirm delete',
      'state.loading': 'Reading MCP configuration…',
      'state.empty.title': 'No MCP server configured yet',
      'state.empty.desc': 'Pick a quick configuration from the marketplace, fill the form, or paste JSON. Its tools appear in the model’s tool list once connected.',
      'state.error': 'Could not load',
      'count.configured': 'configured',
      'count.enabled': 'enabled',
      'count.tools': 'tools',
      'badge.ready': 'connected',
      'badge.starting': 'starting',
      'badge.pending': 'no tools',
      'badge.error': 'error',
      'badge.disabled': 'disabled',
      'badge.external': 'external',
      'badge.auto': 'automatic',
      'badge.manual': 'command',
      'badge.stdio': 'local process',
      'badge.http': 'remote HTTP',
      'scope.all': 'All sessions',
      'scope.workspace': 'Workspaces',
      'scope.session': 'Sessions',
      'scope.label': 'Scope',
      'scope.save': 'Save scope',
      'scope.workspaceEmpty': 'No workspace yet',
      'scope.sessionEmpty': 'No live session',
      'mode.label': 'Invocation',
      'mode.auto': 'Auto',
      'mode.manual': 'Manual',
      'mode.autoHint': 'The model can see and call these tools',
      'mode.manualHint': 'Tools stay hidden from the model; run them with /mcp call or the console below',
      'form.name': 'Name',
      'form.nameHint': 'Also the tool prefix mcp__<name>__; 1-32 letters, digits, - or _',
      'form.title': 'Display name',
      'form.transport': 'Transport',
      'form.command': 'Command',
      'form.commandHint': 'e.g. npx, node, uvx, docker',
      'form.args': 'Arguments',
      'form.argsHint': 'One argument per line; a single pasted line is split on spaces',
      'form.cwd': 'Working directory (optional)',
      'form.env': 'Environment',
      'form.envHint': 'Leave empty to keep the stored value. Use env:NAME to reference a process environment variable instead of storing the secret.',
      'form.url': 'Endpoint URL',
      'form.headers': 'Headers',
      'form.timeout': 'Call timeout (ms, optional)',
      'form.addRow': 'Add row',
      'form.keyPlaceholder': 'NAME',
      'form.valuePlaceholder': 'value',
      'form.remove': 'Remove row',
      'form.required': 'required',
      'form.keep': 'empty keeps the current value',
      'import.title': 'Import JSON',
      'import.hint': 'Accepts Claude Desktop / Cursor mcpServers, VS Code servers, or a single {command}/{url} entry. Multiple servers at once are fine.',
      'import.placeholder': '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/data"]\n    }\n  }\n}',
      'import.preview': 'Preview',
      'import.previewEmpty': 'Paste JSON, then preview',
      'import.createAll': 'Create all',
      'import.none': 'No usable server found',
      'market.search': 'Search servers, capabilities or vendors',
      'market.all': 'All',
      'market.add': 'Quick add',
      'market.docs': 'Docs',
      'market.verified': 'verified',
      'market.needs': 'Requirements',
      'market.needsKey': 'Needs a key',
      'market.oauth': 'Browser authorization',
      'market.noAuth': 'No key needed',
      'market.exists': 'Configured',
      'market.missing': 'Missing',
      'market.forceAdd': 'Add anyway',
      'market.fields': 'Quick configuration',
      'invoke.title': 'Manual console',
      'invoke.desc': 'Pick a server and a tool, fill JSON arguments, and run it directly — no model involved. Useful for debugging and for manual mode.',
      'invoke.server': 'Server',
      'invoke.tool': 'Tool',
      'invoke.args': 'Arguments (JSON)',
      'invoke.result': 'Result',
      'invoke.pickServer': 'Select a connected server first',
      'invoke.noTools': 'No tool discovered for this server yet',
      'invoke.help': 'Command reference',
      'invoke.helpDesc': 'Type these in the composer; opening this page is optional.',
      'invoke.autoTitle': 'Automatic invocation',
      'invoke.autoDesc': 'With automatic mode the server tools join the model’s tool list and the model calls them when needed.',
      'invoke.manualTitle': 'Slash command / manual invocation',
      'invoke.manualDesc': 'In manual mode the tools stay hidden from the model and only run from /mcp call or this console.',
      'drawer.create': 'Add MCP server',
      'drawer.edit': 'Edit',
      'drawer.manual': 'Manual setup',
      'drawer.import': 'Import JSON',
      'drawer.marketAdd': 'Quick add',
      'notice.created': 'Added; connecting now',
      'notice.saved': 'Saved',
      'notice.removed': 'Removed',
      'notice.testOk': 'Connection healthy',
      'notice.testFail': 'Connection failed',
      'notice.failed': 'Action failed',
      'notice.disabled': 'Disabled',
      'notice.enabled': 'Enabled',
      'notice.scopeSaved': 'Scope updated',
      'notice.modeAuto': 'Switched to automatic invocation',
      'notice.modeManual': 'Switched to command invocation',
      'notice.loaded': 'Refreshed',
      'confirm.remove': 'Removing it deletes the configuration and connection, and the model stops seeing these tools.',
      'error.unknown': 'Unknown error',
      'tools.empty': 'No tools',
      'tools.count': 'tools',
      'meta.command': 'Command',
      'meta.url': 'URL',
      'meta.scope': 'Scope',
      'meta.mode': 'Mode',
      'meta.updated': 'updated',
      'footer.host': 'Configuration lives in the Host; secrets never travel back to this page.',
    }

    /** Locale runtime, wired in apply(). */
    const runtime = {
      /** @type {(key: string) => string} */
      t: (key) => key,
      /** @type {() => string} */
      locale: () => 'zh',
      /** @type {(fn: () => void) => () => void} */
      subscribe: () => () => {},
      /** @type {(panelId: string) => void} */
      selectPanel: () => {},
    }

    /** @returns {string} localized text for one key. */
    const t = (key) => runtime.t(key)

    /** @returns {string} the active locale id. */
    const locale = () => runtime.locale()

    /** Re-render when the locale changes. @returns {void} */
    function useLocaleTick() {
      const [, force] = React.useState(0)
      React.useEffect(
        () => runtime.subscribe(() => force((value) => value + 1)),
        [],
      )
    }

    /** @param {unknown} value - a `{zh,en}` pair or plain string. @returns {string} localized text. */
    function localized(value) {
      if (value === null || value === undefined) return ''
      if (typeof value === 'string') return value
      const current = locale()
      return value[current] ?? value.zh ?? value.en ?? ''
    }

    // -----------------------------------------------------------------------
    // Styles (theme tokens only)
    // -----------------------------------------------------------------------

    const CSS = `
.mcp-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.mcp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 24px 12px}
.mcp-head-main{min-width:0}
.mcp-title{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.mcp-sub{margin:4px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-width:720px}
.mcp-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.mcp-tabs{display:flex;align-items:center;gap:4px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mcp-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:9px 12px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;line-height:1;font-family:inherit;border-bottom:2px solid transparent}
.mcp-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.mcp-tab.is-active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.mcp-tab-count{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}
.mcp-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 24px 40px}
.mcp-inner{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.mcp-stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:2px}
.mcp-stat{display:flex;align-items:baseline;gap:6px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.mcp-stat b{font-size:14px;font-weight:600}
.mcp-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.mcp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.mcp-card-head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px}
.mcp-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;margin-top:6px;background:var(--dsw-alias-state-idle-primary)}
.mcp-dot.is-ready{background:var(--dsw-alias-state-success-primary)}
.mcp-dot.is-pending,.mcp-dot.is-starting{background:var(--dsw-alias-state-warn-primary)}
.mcp-dot.is-error{background:var(--dsw-alias-state-error-primary)}
.mcp-card-title{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
.mcp-card-title strong{font-size:13px;font-weight:600}
.mcp-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11px}
.mcp-card-id{color:var(--dsw-alias-label-secondary)}
.mcp-card-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.6}
.mcp-card-spacer{flex:1 1 auto}
.mcp-card-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.mcp-card-body{border-top:1px solid var(--dsw-alias-border-l1);padding:12px 14px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-base)}
.mcp-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.mcp-badge.is-ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
.mcp-badge.is-warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
.mcp-badge.is-err{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.mcp-badge.is-brand{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}
.mcp-tool-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.mcp-tool{display:flex;flex-direction:column;gap:2px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.mcp-tool-name{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px}
.mcp-tool-desc{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.55}
.mcp-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 11px;height:30px;font-size:12px;line-height:1;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .12s ease,border-color .12s ease,opacity .12s ease}
.mcp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.mcp-btn:disabled{opacity:.5;cursor:default}
.mcp-btn.is-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);color:var(--dsw-alias-label-primary);font-weight:600}
.mcp-btn.is-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-brand-primary)}
.mcp-btn.is-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.mcp-btn.is-danger.is-armed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);font-weight:600}
.mcp-btn.is-sm{height:26px;padding:0 8px;font-size:11.5px}
.mcp-btn.is-ghost{background:transparent;border-color:transparent}
.mcp-btn.is-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:transparent}
.mcp-field{display:flex;flex-direction:column;gap:5px}
.mcp-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}
.mcp-hint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.mcp-input,.mcp-textarea,.mcp-select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:7px 9px;font-size:12.5px;font-family:inherit;outline:none}
.mcp-input:focus,.mcp-textarea:focus,.mcp-select:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.mcp-textarea{min-height:110px;resize:vertical;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;line-height:1.6}
.mcp-input::placeholder,.mcp-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.mcp-row{display:flex;gap:8px;align-items:center}
.mcp-row > *{min-width:0}
.mcp-kv-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(140px,1.4fr) auto;gap:6px;align-items:center}
.mcp-seg{display:inline-flex;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);gap:2px}
.mcp-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;height:24px;padding:0 10px;font-size:11.5px;cursor:pointer;font-family:inherit}
.mcp-seg button.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600}
.mcp-switch{appearance:none;position:relative;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0;flex:0 0 auto}
.mcp-switch.is-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.mcp-switch-dot{position:absolute;top:50%;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transform:translateY(-50%);transition:left .14s ease}
.mcp-switch.is-on .mcp-switch-dot{left:16px}
.mcp-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:48px 24px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);text-align:center}
.mcp-empty h3{margin:0;font-size:14px;font-weight:600}
.mcp-empty p{margin:0;max-width:480px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.mcp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.mcp-market-card{display:flex;flex-direction:column;gap:8px;padding:12px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.mcp-market-card h3{margin:0;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.mcp-market-card p{margin:0;font-size:11.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mcp-market-tags{display:flex;flex-wrap:wrap;gap:4px}
.mcp-market-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:4px}
.mcp-chips{display:flex;flex-wrap:wrap;gap:6px}
.mcp-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 10px;height:24px;font-size:11.5px;cursor:pointer;font-family:inherit}
.mcp-chip.is-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1))}
.mcp-check{display:flex;align-items:flex-start;gap:7px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;font-size:12px;background:var(--dsw-alias-bg-layer-1)}
.mcp-check input{margin:2px 0 0}
.mcp-scope-box{display:flex;flex-direction:column;gap:8px}
.mcp-scope-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}
.mcp-drawer-backdrop{position:fixed;inset:0;background:color-mix(in srgb,var(--dsw-alias-bg-base) 52%,transparent);z-index:60;display:flex;justify-content:flex-end}
.mcp-drawer{width:min(560px,100%);height:100%;background:var(--dsw-alias-bg-overlay);border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;box-shadow:-16px 0 40px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
.mcp-drawer-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mcp-drawer-head h2{margin:0;font-size:14px;font-weight:600;flex:1 1 auto;min-width:0}
.mcp-drawer-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.mcp-drawer-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.mcp-section{display:flex;flex-direction:column;gap:8px;padding-top:4px}
.mcp-section > h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}
.mcp-toast{position:sticky;bottom:0;align-self:center;margin:0 auto 8px;padding:8px 14px;border-radius:999px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 6px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);z-index:5}
.mcp-toast.is-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}
.mcp-toast.is-err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary)}
.mcp-loading{display:flex;align-items:center;gap:8px;padding:28px 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.mcp-spinner{width:13px;height:13px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:mcp-spin .8s linear infinite}
@keyframes mcp-spin{to{transform:rotate(360deg)}}
.mcp-result{margin:0;padding:10px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;line-height:1.65;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.mcp-result.is-err{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.mcp-code{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 9px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px}
.mcp-code code{color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcp-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:720px){.mcp-grid-2{grid-template-columns:1fr}}
.mcp-footer{padding:10px 24px 18px;color:var(--dsw-alias-label-secondary);font-size:11px}
`

    // -----------------------------------------------------------------------
    // API client
    // -----------------------------------------------------------------------

    /** Error carrying the structured payload of a failed action. @param {string} message @param {unknown} [body] */
    function ApiError(message, body) {
      this.name = 'ApiError'
      this.message = message
      this.body = body
    }
    ApiError.prototype = Object.create(Error.prototype)

    /** @returns {Promise<any>} the full MCP Center state. */
    async function fetchState() {
      const response = await fetch(`${API_BASE}/state`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`${t('state.error')}: HTTP ${response.status}`)
      return response.json()
    }

    /**
     * Run one Host action.
     * @param {string} action - action name.
     * @param {Record<string, unknown>} [payload] - payload.
     * @returns {Promise<any>} response body.
     */
    async function postAction(action, payload = {}) {
      const response = await fetch(`${API_BASE}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body?.ok === false) {
        const detail =
          body?.error ??
          (Array.isArray(body?.errors) ? body.errors.join('\n') : null) ??
          `HTTP ${response.status}`
        throw new ApiError(detail, body)
      }
      return body
    }

    // -----------------------------------------------------------------------
    // Small controls
    // -----------------------------------------------------------------------

    /** @param {string} text @returns {string} */
    const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text)

    function Spinner() {
      return h('span', { className: 'mcp-spinner', 'aria-hidden': 'true' })
    }

    function Button({ variant = '', size = '', busy = false, disabled = false, onClick, title, children }) {
      return h(
        'button',
        {
          type: 'button',
          className: ['mcp-btn', variant, size].filter(Boolean).join(' '),
          disabled: disabled || busy,
          onClick,
          title,
        },
        busy ? h(Spinner) : null,
        children,
      )
    }

    function Badge({ tone = '', children, title }) {
      return h('span', { className: ['mcp-badge', tone].filter(Boolean).join(' '), title }, children)
    }

    function Switch({ checked, onChange, label, disabled }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          title: label,
          disabled,
          className: `mcp-switch${checked ? ' is-on' : ''}`,
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'mcp-switch-dot' }),
      )
    }

    function Field({ label, hint, required, children }) {
      return h(
        'div',
        { className: 'mcp-field' },
        h(
          'div',
          { className: 'mcp-label' },
          label,
          required ? h(Badge, { tone: 'is-warn' }, t('form.required')) : null,
        ),
        children,
        hint ? h('div', { className: 'mcp-hint' }, hint) : null,
      )
    }

    function Segmented({ value, options, onChange }) {
      return h(
        'div',
        { className: 'mcp-seg', role: 'group' },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              className: value === option.value ? 'is-active' : '',
              onClick: () => onChange(option.value),
              title: option.title,
            },
            option.label,
          ),
        ),
      )
    }

    /**
     * Editable key/value rows.
     * @param {{ rows: Array<{key: string, value: string, masked?: string, set?: boolean}>, onChange: (rows: any[]) => void, keyPlaceholder?: string }} props
     * @returns {any} element.
     */
    function KeyValueEditor({ rows, onChange, keepHint }) {
      const update = (index, patch) => {
        const next = rows.map((row, position) => (position === index ? { ...row, ...patch } : row))
        onChange(next)
      }
      return h(
        'div',
        { className: 'mcp-field' },
        rows.length === 0
          ? h('div', { className: 'mcp-hint' }, t('form.addRow'))
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              rows.map((row, index) =>
                h(
                  'div',
                  { className: 'mcp-kv-row', key: index },
                  h('input', {
                    className: 'mcp-input mcp-mono',
                    value: row.key,
                    placeholder: t('form.keyPlaceholder'),
                    spellCheck: false,
                    onChange: (event) => update(index, { key: event.target.value }),
                  }),
                  h('input', {
                    className: 'mcp-input mcp-mono',
                    value: row.value,
                    type: row.secret ? 'password' : 'text',
                    placeholder: row.masked ? `${row.masked} — ${keepHint}` : t('form.valuePlaceholder'),
                    spellCheck: false,
                    onChange: (event) => update(index, { value: event.target.value }),
                  }),
                  h(
                    Button,
                    {
                      size: 'is-sm',
                      variant: 'is-ghost',
                      title: t('form.remove'),
                      onClick: () => onChange(rows.filter((_, position) => position !== index)),
                    },
                    '−',
                  ),
                ),
              ),
            ),
        h(
          Button,
          {
            size: 'is-sm',
            onClick: () => onChange([...rows, { key: '', value: '', secret: true }]),
          },
          `+ ${t('form.addRow')}`,
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Marketplace requirements
    // -----------------------------------------------------------------------

    /**
     * Evaluate one marketplace requirement against the probed environment.
     * @param {{kind: string, detail?: unknown, hard?: boolean}} requirement - requirement.
     * @param {any} environment - host environment payload.
     * @returns {{kind: string, label: string, met: boolean, warn: boolean, hard: boolean}} evaluation.
     */
    function evaluateRequirement(requirement, environment) {
      const kind = requirement?.kind ?? 'network'
      const label = localized(requirement?.detail) || kind
      const env = environment ?? {}
      let met = true
      let warn = false
      if (kind === 'node') {
        met = env.hasNode === true
        const required = Number((/\bNode(?:\.js)?\s+(\d+)/i.exec(label) ?? [])[1] ?? 0)
        const actual = Number((/(\d+)\./.exec(String(env.node ?? '')) ?? [])[1] ?? 0)
        warn = met && required > 0 && actual > 0 && actual < required
      } else if (kind === 'python') {
        met = env.hasPython === true
      } else if (kind === 'uv') {
        met = env.hasUv === true
      } else if (kind === 'docker') {
        met = env.hasDocker === true
      } else if (kind === 'oauth') {
        // The bundled MCP client sends header credentials only.
        met = env.oauthSupport === true
      } else if (kind === 'api-key') {
        met = true
      }
      return { kind, label, met, warn, hard: requirement?.hard !== false }
    }

    /** @param {{kind: string}} requirement @returns {string} badge tone. */
    function requirementTone(requirement) {
      if (requirement.kind === 'api-key' || requirement.kind === 'oauth') return 'is-brand'
      return ''
    }

    /** @param {{kind: string}} requirement @returns {string} icon-ish prefix. */
    function requirementPrefix(requirement) {
      if (requirement.kind === 'api-key') return '🔑 '
      if (requirement.kind === 'oauth') return '🔐 '
      if (requirement.kind === 'docker') return '🐳 '
      if (requirement.kind === 'python' || requirement.kind === 'uv') return '🐍 '
      if (requirement.kind === 'node') return '⬢ '
      if (requirement.kind === 'network') return '🌐 '
      return ''
    }

    // -----------------------------------------------------------------------
    // State hook
    // -----------------------------------------------------------------------

    /**
     * Own the page's data, action runner and transient notice.
     * @returns {Record<string, any>} store.
     */
    function useMcpStore() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const timer = React.useRef(null)

      const notify = React.useCallback((kind, text) => {
        setNotice({ kind, text })
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setNotice(null), 4000)
      }, [])

      const reload = React.useCallback(
        async (quiet = false) => {
          try {
            const next = await fetchState()
            setData(next)
            setError(null)
            if (!quiet) notify('ok', t('notice.loaded'))
          } catch (failure) {
            setError(failure.message)
          }
        },
        [notify],
      )

      React.useEffect(() => {
        reload(true)
        const handle = setInterval(() => reload(true), 6000)
        return () => {
          clearInterval(handle)
          if (timer.current) clearTimeout(timer.current)
        }
      }, [reload])

      /**
       * Run one action, then refresh.
       * @param {string} key - busy key.
       * @param {string} action - host action.
       * @param {Record<string, unknown>} payload - payload.
       * @param {string} [successText] - notice on success.
       * @returns {Promise<any>} response body.
       */
      const run = React.useCallback(
        async (key, action, payload, successText) => {
          setBusy(key)
          try {
            const body = await postAction(action, payload)
            await reload(true)
            if (successText) notify('ok', successText)
            return body
          } catch (failure) {
            notify('err', failure.message || t('notice.failed'))
            throw failure
          } finally {
            setBusy('')
          }
        },
        [notify, reload],
      )

      return { data, error, busy, notice, notify, reload, run }
    }

    // -----------------------------------------------------------------------
    // Page
    // -----------------------------------------------------------------------

    function McpPage() {
      useLocaleTick()
      const store = useMcpStore()
      const [tab, setTab] = React.useState('configured')
      const [drawer, setDrawer] = React.useState(null)

      const servers = store.data?.servers ?? []
      const marketplace = store.data?.marketplace ?? { categories: [], servers: [] }
      const environment = store.data?.environment ?? {}

      const configuredIds = React.useMemo(
        () => new Set(servers.map((server) => server.id)),
        [servers],
      )

      return h(
        'div',
        { className: 'mcp-page', 'data-dsh-mcp-center-view': '' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'mcp-head' },
          h(
            'div',
            { className: 'mcp-head-main' },
            h('h1', { className: 'mcp-title' }, t('title')),
            h('p', { className: 'mcp-sub' }, t('subtitle')),
          ),
          h(
            'div',
            { className: 'mcp-actions' },
            h(
              Button,
              { size: 'is-sm', busy: store.busy === 'refresh', onClick: () => store.reload(false) },
              t('action.refresh'),
            ),
            h(
              Button,
              { size: 'is-sm', variant: 'is-primary', onClick: () => setDrawer({ mode: 'create' }) },
              `+ ${t('action.add')}`,
            ),
          ),
        ),
        h(
          'nav',
          { className: 'mcp-tabs', role: 'tablist' },
          [
            ['configured', t('tab.configured'), servers.length],
            ['market', t('tab.market'), marketplace.servers?.length ?? 0],
            ['invoke', t('tab.invoke'), null],
          ].map(([id, label, count]) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === id ? 'true' : 'false',
                className: `mcp-tab${tab === id ? ' is-active' : ''}`,
                onClick: () => setTab(id),
              },
              label,
              count === null ? null : h('span', { className: 'mcp-tab-count' }, String(count)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'mcp-body' },
          store.error
            ? h(
                'div',
                { className: 'mcp-inner' },
                h(
                  'div',
                  { className: 'mcp-empty' },
                  h('h3', null, t('state.error')),
                  h('p', null, store.error),
                  h(Button, { onClick: () => store.reload(false) }, t('action.refresh')),
                ),
              )
            : store.data === null
              ? h(
                  'div',
                  { className: 'mcp-loading' },
                  h(Spinner),
                  h('span', null, t('state.loading')),
                )
              : h(
                  'div',
                  { className: 'mcp-inner' },
                  tab === 'configured'
                    ? h(ConfiguredTab, {
                        servers,
                        environment,
                        busy: store.busy,
                        store,
                        onEdit: (server) => setDrawer({ mode: 'edit', server }),
                        onAdd: () => setDrawer({ mode: 'create' }),
                        onImport: () => setDrawer({ mode: 'import' }),
                        onGoMarket: () => setTab('market'),
                      })
                    : tab === 'market'
                      ? h(MarketTab, {
                          marketplace,
                          environment,
                          configuredIds,
                          store,
                          onAdd: (entry) => setDrawer({ mode: 'market', entry }),
                        })
                      : h(InvokeTab, { servers, environment, store }),
                  store.notice
                    ? h(
                        'div',
                        {
                          className: `mcp-toast${store.notice.kind === 'err' ? ' is-err' : ' is-ok'}`,
                          role: 'status',
                        },
                        store.notice.text,
                      )
                    : null,
                ),
        ),
        h('div', { className: 'mcp-footer' }, t('footer.host')),
        drawer
          ? h(AddDrawer, {
              state: drawer,
              environment,
              marketplace,
              store,
              onClose: () => setDrawer(null),
              onDone: () => setDrawer(null),
            })
          : null,
      )
    }

    // -----------------------------------------------------------------------
    // Configured tab
    // -----------------------------------------------------------------------

    function ConfiguredTab({ servers, environment, busy, store, onEdit, onAdd, onImport, onGoMarket }) {
      const counts = store.data?.counts ?? { enabled: 0, tools: 0 }
      if (servers.length === 0) {
        return h(
          'div',
          { className: 'mcp-empty' },
          h('h3', null, t('state.empty.title')),
          h('p', null, t('state.empty.desc')),
          h(
            'div',
            { className: 'mcp-row', style: { justifyContent: 'center', flexWrap: 'wrap' } },
            h(Button, { variant: 'is-primary', onClick: onGoMarket }, t('action.add')),
            h(Button, { onClick: onAdd }, t('drawer.manual')),
            h(Button, { onClick: onImport }, t('action.import')),
          ),
          h('p', { className: 'mcp-hint' }, '/mcp list · /mcp call <server> <tool>'),
        )
      }
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'mcp-stats' },
          h('div', { className: 'mcp-stat' }, h('b', null, String(servers.length)), h('span', null, t('count.configured'))),
          h('div', { className: 'mcp-stat' }, h('b', null, String(counts.enabled ?? 0)), h('span', null, t('count.enabled'))),
          h('div', { className: 'mcp-stat' }, h('b', null, String(counts.tools ?? 0)), h('span', null, t('count.tools'))),
        ),
        servers.map((server) =>
          h(ServerCard, {
            key: server.id,
            server,
            environment,
            busy,
            store,
            onEdit,
          }),
        ),
      )
    }

    /** @param {any} server @returns {string} status key. */
    function statusKey(server) {
      if (!server.enabled) return 'disabled'
      const phase = server.status?.phase
      if (phase === 'error') return 'error'
      if (phase === 'ready') return 'ready'
      if (phase === 'starting' || phase === 'installing' || phase === 'updating') return 'starting'
      return server.toolCount > 0 ? 'ready' : 'pending'
    }

    /** @param {string} key @returns {string} badge tone class. */
    function statusTone(key) {
      if (key === 'ready') return 'is-ok'
      if (key === 'error') return 'is-err'
      if (key === 'starting' || key === 'pending') return 'is-warn'
      return ''
    }

    function ServerCard({ server, environment, busy, store, onEdit }) {
      const [expanded, setExpanded] = React.useState(false)
      const [armRemove, setArmRemove] = React.useState(false)
      const [scopeOpen, setScopeOpen] = React.useState(false)
      const key = statusKey(server)
      const scope = server.scope ?? { kind: 'all', workspaceIds: [], sessionIds: [] }
      const scopeText =
        scope.kind === 'all'
          ? t('scope.all')
          : scope.kind === 'workspace'
            ? `${t('scope.workspace')} (${scope.workspaceIds.length})`
            : `${t('scope.session')} (${scope.sessionIds.length})`

      React.useEffect(() => {
        if (!armRemove) return undefined
        const handle = setTimeout(() => setArmRemove(false), 4000)
        return () => clearTimeout(handle)
      }, [armRemove])

      const toggleEnabled = async (next) => {
        await store.run(`toggle-${server.id}`, 'toggle', { id: server.id, enabled: next }, next ? t('notice.enabled') : t('notice.disabled'))
      }

      const setMode = async (mode) => {
        if (mode === server.mode) return
        await store.run(
          `mode-${server.id}`,
          'update',
          { id: server.id, patch: { mode } },
          mode === 'auto' ? t('notice.modeAuto') : t('notice.modeManual'),
        )
      }

      const remove = async () => {
        if (!armRemove) {
          setArmRemove(true)
          return
        }
        await store.run(`remove-${server.id}`, 'remove', { id: server.id }, t('notice.removed'))
      }

      const test = async () => {
        const body = await store.run(`test-${server.id}`, 'test', { id: server.id })
        const result = body?.result
        store.notify(result?.ok ? 'ok' : 'err', result?.ok ? t('notice.testOk') : t('notice.testFail'))
        setExpanded(true)
      }

      return h(
        'section',
        { className: 'mcp-card', 'data-server': server.id },
        h(
          'div',
          { className: 'mcp-card-head' },
          h('span', { className: `mcp-dot is-${key}`, 'aria-hidden': 'true' }),
          h(
            'div',
            { style: { minWidth: 0, flex: '1 1 auto' } },
            h(
              'div',
              { className: 'mcp-card-title' },
              h('strong', null, server.title || server.id),
              h('span', { className: 'mcp-mono mcp-card-id' }, server.id),
              h(Badge, { tone: statusTone(key) }, t(`badge.${key}`)),
              h(Badge, null, server.transport === 'stdio' ? t('badge.stdio') : t('badge.http')),
              server.origin === 'external' ? h(Badge, { tone: 'is-brand' }, t('badge.external')) : null,
              h(Badge, { tone: server.mode === 'manual' ? 'is-warn' : '' }, server.mode === 'manual' ? t('badge.manual') : t('badge.auto')),
            ),
            h(
              'div',
              { className: 'mcp-card-meta' },
              h(
                'span',
                { className: 'mcp-mono' },
                server.transport === 'stdio'
                  ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
                  : server.url || '—',
              ),
              h('span', null, '·'),
              h('span', null, `${server.toolCount} ${t('tools.count')}`),
              h('span', null, '·'),
              h('span', null, `${t('meta.scope')}: ${scopeText}`),
              server.status?.message ? h('span', { title: server.status.message }, `· ${server.status.message}`) : null,
            ),
          ),
          h(
            'div',
            { className: 'mcp-card-actions' },
            h(Switch, {
              checked: server.enabled,
              label: server.enabled ? t('notice.disabled') : t('notice.enabled'),
              disabled: busy === `toggle-${server.id}`,
              onChange: toggleEnabled,
            }),
            h(
              Button,
              { size: 'is-sm', onClick: () => setScopeOpen((value) => !value) },
              t('scope.label'),
            ),
            h(Button, { size: 'is-sm', busy: busy === `test-${server.id}`, onClick: test }, t('action.test')),
            h(Button, { size: 'is-sm', onClick: () => onEdit(server) }, t('action.edit')),
            h(
              Button,
              { size: 'is-sm', onClick: () => setExpanded((value) => !value) },
              expanded ? t('action.collapse') : t('action.details'),
            ),
            server.origin === 'external'
              ? null
              : h(
                  Button,
                  {
                    size: 'is-sm',
                    variant: `is-danger${armRemove ? ' is-armed' : ''}`,
                    busy: busy === `remove-${server.id}`,
                    onClick: remove,
                    title: t('confirm.remove'),
                  },
                  armRemove ? t('action.confirmRemove') : '🗑',
                ),
          ),
        ),
        expanded || scopeOpen
          ? h(
              'div',
              { className: 'mcp-card-body' },
              h(
                'div',
                { className: 'mcp-row', style: { flexWrap: 'wrap' } },
                h('span', { className: 'mcp-hint' }, t('mode.label')),
                h(Segmented, {
                  value: server.mode,
                  options: [
                    { value: 'auto', label: t('mode.auto'), title: t('mode.autoHint') },
                    { value: 'manual', label: t('mode.manual'), title: t('mode.manualHint') },
                  ],
                  onChange: setMode,
                }),
                h('span', { className: 'mcp-hint' }, server.mode === 'auto' ? t('mode.autoHint') : t('mode.manualHint')),
              ),
              scopeOpen
                ? h(ScopeEditor, { server, environment, store })
                : null,
              expanded
                ? h(
                    'div',
                    { className: 'mcp-section' },
                    h('h4', null, `${server.toolCount} ${t('tools.count')}`),
                    server.tools.length === 0
                      ? h('div', { className: 'mcp-hint' }, t('tools.empty'))
                      : h(
                          'ul',
                          { className: 'mcp-tool-list' },
                          server.tools.map((tool) =>
                            h(
                              'li',
                              { className: 'mcp-tool', key: tool.name },
                              h('span', { className: 'mcp-tool-name' }, tool.name),
                              tool.description ? h('span', { className: 'mcp-tool-desc' }, tool.description) : null,
                            ),
                          ),
                        ),
                    h(
                      'div',
                      { className: 'mcp-hint' },
                      `${t('invoke.help')}: /mcp call ${server.id} <tool> '{"…":1}'`,
                    ),
                  )
                : null,
            )
          : null,
      )
    }

    function ScopeEditor({ server, environment, store }) {
      const scope = server.scope ?? { kind: 'all', workspaceIds: [], sessionIds: [] }
      const [kind, setKind] = React.useState(scope.kind)
      const [workspaceIds, setWorkspaceIds] = React.useState(scope.workspaceIds ?? [])
      const [sessionIds, setSessionIds] = React.useState(scope.sessionIds ?? [])
      const workspaces = environment?.workspaces ?? []
      const sessions = environment?.sessions ?? []

      const toggle = (list, value) =>
        list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

      const save = async () => {
        await store.run(
          `scope-${server.id}`,
          'update',
          { id: server.id, patch: { scope: { kind, workspaceIds, sessionIds } } },
          t('notice.scopeSaved'),
        )
      }

      return h(
        'div',
        { className: 'mcp-scope-box' },
        h(Segmented, {
          value: kind,
          options: [
            { value: 'all', label: t('scope.all') },
            { value: 'workspace', label: t('scope.workspace') },
            { value: 'session', label: t('scope.session') },
          ],
          onChange: setKind,
        }),
        kind === 'workspace'
          ? h(
              'div',
              { className: 'mcp-scope-list' },
              workspaces.length === 0
                ? h('div', { className: 'mcp-hint' }, t('scope.workspaceEmpty'))
                : workspaces.map((workspace) =>
                    h(
                      'label',
                      { className: 'mcp-check', key: workspace.id },
                      h('input', {
                        type: 'checkbox',
                        checked: workspaceIds.includes(workspace.id),
                        onChange: () => setWorkspaceIds((list) => toggle(list, workspace.id)),
                      }),
                      h(
                        'span',
                        null,
                        h('strong', null, workspace.title || workspace.id),
                        h('div', { className: 'mcp-mono mcp-hint' }, workspace.path),
                      ),
                    ),
                  ),
            )
          : null,
        kind === 'session'
          ? h(
              'div',
              { className: 'mcp-scope-list' },
              sessions.length === 0
                ? h('div', { className: 'mcp-hint' }, t('scope.sessionEmpty'))
                : sessions.map((session) =>
                    h(
                      'label',
                      { className: 'mcp-check', key: session.id },
                      h('input', {
                        type: 'checkbox',
                        checked: sessionIds.includes(session.id),
                        onChange: () => setSessionIds((list) => toggle(list, session.id)),
                      }),
                      h(
                        'span',
                        null,
                        h('div', { className: 'mcp-mono' }, session.id.slice(0, 22)),
                        h('div', { className: 'mcp-hint mcp-mono' }, session.cwd || ''),
                      ),
                    ),
                  ),
            )
          : null,
        h(
          'div',
          { className: 'mcp-row' },
          h(
            Button,
            { size: 'is-sm', variant: 'is-primary', busy: store.busy === `scope-${server.id}`, onClick: save },
            t('scope.save'),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Marketplace tab
    // -----------------------------------------------------------------------

    function MarketTab({ marketplace, environment, configuredIds, store, onAdd }) {
      const [query, setQuery] = React.useState('')
      const [category, setCategory] = React.useState('all')
      const entries = marketplace?.servers ?? []
      const categories = marketplace?.categories ?? []
      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return entries.filter((entry) => {
          if (category !== 'all' && entry.category !== category) return false
          if (!needle) return true
          return (
            entry.id.toLowerCase().includes(needle) ||
            JSON.stringify(entry.title ?? '').toLowerCase().includes(needle) ||
            JSON.stringify(entry.summary ?? '').toLowerCase().includes(needle) ||
            (entry.tags ?? []).some((tag) => String(tag).toLowerCase().includes(needle))
          )
        })
      }, [entries, query, category])

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'mcp-row', style: { flexWrap: 'wrap', gap: '8px' } },
          h('input', {
            className: 'mcp-input',
            style: { flex: '1 1 260px' },
            placeholder: t('market.search'),
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            Button,
            { size: 'is-sm', onClick: () => store.run('refresh', 'refresh', {}, t('notice.loaded')) },
            t('action.refresh'),
          ),
        ),
        h(
          'div',
          { className: 'mcp-chips' },
          [{ id: 'all', title: { zh: t('market.all'), en: t('market.all') } }, ...categories].map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                className: `mcp-chip${category === entry.id ? ' is-active' : ''}`,
                onClick: () => setCategory(entry.id),
              },
              localized(entry.title),
            ),
          ),
        ),
        filtered.length === 0
          ? h('div', { className: 'mcp-empty' }, h('p', null, t('import.none')))
          : h(
              'div',
              { className: 'mcp-grid' },
              filtered.map((entry) =>
                h(MarketCard, {
                  key: entry.id,
                  entry,
                  environment,
                  configured: configuredIds.has(entry.id),
                  onAdd: () => onAdd(entry),
                }),
              ),
            ),
      )
    }

    function MarketCard({ entry, environment, configured, onAdd }) {
      const requirements = (entry.requirements ?? []).map((requirement) => evaluateRequirement(requirement, environment))
      const missing = requirements.filter((requirement) => requirement.hard && !requirement.met)
      const auth = entry.auth ?? 'none'
      return h(
        'article',
        { className: 'mcp-market-card' },
        h(
          'h3',
          null,
          localized(entry.title) || entry.id,
          h('span', { className: 'mcp-mono mcp-card-id' }, entry.id),
        ),
        h('p', null, localized(entry.summary)),
        h(
          'div',
          { className: 'mcp-market-tags' },
          h(Badge, null, entry.transport === 'stdio' ? t('badge.stdio') : t('badge.http')),
          auth === 'api-key'
            ? h(Badge, { tone: 'is-brand' }, requirementPrefix({ kind: 'api-key' }) + t('market.needsKey'))
            : auth === 'oauth' || auth === 'local-token'
              ? h(Badge, { tone: 'is-brand' }, t('market.oauth'))
              : h(Badge, { tone: 'is-ok' }, t('market.noAuth')),
          requirements.map((requirement, index) =>
            h(
              Badge,
              {
                key: index,
                tone: requirement.met ? (requirement.warn ? 'is-warn' : requirementTone(requirement)) : 'is-warn',
                title: requirement.met ? requirement.label : `${t('market.missing')}: ${requirement.label}`,
              },
              `${requirementPrefix(requirement)}${requirement.label}`,
            ),
          ),
        ),
        configured ? h(Badge, { tone: 'is-ok' }, t('market.exists')) : null,
        h(
          'div',
          { className: 'mcp-market-foot' },
          h(
            Button,
            {
              size: 'is-sm',
              variant: 'is-primary',
              onClick: onAdd,
              disabled: configured,
              title: missing.length > 0 ? `${t('market.missing')}: ${missing.map((item) => item.label).join(', ')}` : undefined,
            },
            t('market.add'),
          ),
          entry.docs
            ? h(
                'a',
                {
                  className: 'mcp-btn is-sm is-ghost',
                  href: entry.docs,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                },
                t('market.docs'),
              )
            : null,
          entry.verifiedAt ? h('span', { className: 'mcp-hint' }, `${t('market.verified')} ${entry.verifiedAt}`) : null,
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Invoke tab
    // -----------------------------------------------------------------------

    const COMMAND_HELP = [
      '/mcp list',
      '/mcp tools [server]',
      '/mcp call <server> <tool> \'{"arg":1}\'',
      '/mcp test <server> [tool] [json]',
      '/mcp add <name> <json>',
      '/mcp rm <server>',
      '/mcp auto <server>',
      '/mcp manual <server>',
      '/mcp scope <server> all|workspace|session [ids…]',
      '/mcp enable <server>',
      '/mcp disable <server>',
      '/mcp market [query]',
    ]

    function InvokeTab({ servers, environment, store }) {
      const connected = servers.filter((server) => server.toolCount > 0)
      const [serverId, setServerId] = React.useState(connected[0]?.id ?? '')
      const [tool, setTool] = React.useState('')
      const [argsText, setArgsText] = React.useState('{}')
      const [result, setResult] = React.useState(null)
      const [copied, setCopied] = React.useState('')
      const selected = connected.find((server) => server.id === serverId) ?? null
      const tools = selected?.tools ?? []
      const activeTool = tools.find((entry) => entry.rawName === tool) ?? tools[0] ?? null

      React.useEffect(() => {
        if (!selected && connected.length > 0) setServerId(connected[0].id)
      }, [connected, selected])

      const run = async () => {
        if (!selected || !activeTool) return
        let parsed = {}
        try {
          parsed = argsText.trim() === '' ? {} : JSON.parse(argsText)
        } catch (error) {
          store.notify('err', `JSON: ${error.message}`)
          return
        }
        try {
          const body = await store.run(
            'invoke',
            'call',
            { id: selected.id, tool: activeTool.rawName, arguments: parsed },
            null,
          )
          setResult(body.result)
        } catch (failure) {
          setResult({ isError: true, error: failure.message, content: [] })
        }
      }

      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(text)
          setTimeout(() => setCopied(''), 1500)
        } catch {
          store.notify('err', t('notice.failed'))
        }
      }

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'mcp-grid-2' },
          h(
            'div',
            { className: 'mcp-card' },
            h(
              'div',
              { className: 'mcp-card-head', style: { flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
              h('strong', null, t('invoke.autoTitle')),
              h('span', { className: 'mcp-hint' }, t('invoke.autoDesc')),
            ),
          ),
          h(
            'div',
            { className: 'mcp-card' },
            h(
              'div',
              { className: 'mcp-card-head', style: { flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
              h('strong', null, t('invoke.manualTitle')),
              h('span', { className: 'mcp-hint' }, t('invoke.manualDesc')),
            ),
          ),
        ),
        h(
          'section',
          { className: 'mcp-card' },
          h(
            'div',
            { className: 'mcp-card-head', style: { flexDirection: 'column', alignItems: 'stretch', gap: '2px' } },
            h('strong', null, t('invoke.title')),
            h('span', { className: 'mcp-hint' }, t('invoke.desc')),
          ),
          h(
            'div',
            { className: 'mcp-card-body' },
            connected.length === 0
              ? h('div', { className: 'mcp-hint' }, t('invoke.pickServer'))
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'mcp-grid-2' },
                    h(
                      Field,
                      { label: t('invoke.server') },
                      h(
                        'select',
                        {
                          className: 'mcp-select',
                          value: serverId,
                          onChange: (event) => {
                            setServerId(event.target.value)
                            setTool('')
                          },
                        },
                        connected.map((server) =>
                          h('option', { key: server.id, value: server.id }, `${server.title || server.id} (${server.id})`),
                        ),
                      ),
                    ),
                    h(
                      Field,
                      { label: t('invoke.tool') },
                      h(
                        'select',
                        {
                          className: 'mcp-select',
                          value: activeTool?.rawName ?? '',
                          onChange: (event) => setTool(event.target.value),
                        },
                        tools.length === 0
                          ? h('option', { value: '' }, t('invoke.noTools'))
                          : tools.map((entry) => h('option', { key: entry.name, value: entry.rawName }, entry.rawName)),
                      ),
                    ),
                  ),
                  activeTool?.description ? h('div', { className: 'mcp-hint' }, activeTool.description) : null,
                  h(
                    Field,
                    { label: t('invoke.args'), hint: JSON.stringify(activeTool?.parameters ?? {}, null, 0).slice(0, 240) },
                    h('textarea', {
                      className: 'mcp-textarea',
                      value: argsText,
                      onChange: (event) => setArgsText(event.target.value),
                      spellCheck: false,
                    }),
                  ),
                  h(
                    'div',
                    { className: 'mcp-row' },
                    h(
                      Button,
                      { variant: 'is-primary', busy: store.busy === 'invoke', onClick: run },
                      t('action.run'),
                    ),
                    result
                      ? h(
                          Button,
                          {
                            size: 'is-sm',
                            onClick: () => copy(JSON.stringify(result, null, 2)),
                          },
                          copied ? t('action.copied') : t('action.copy'),
                        )
                      : null,
                  ),
                  result
                    ? h(
                        'pre',
                        { className: `mcp-result${result.isError ? ' is-err' : ''}` },
                        JSON.stringify(result, null, 2),
                      )
                    : null,
                ),
          ),
        ),
        h(
          'section',
          { className: 'mcp-card' },
          h(
            'div',
            { className: 'mcp-card-head', style: { flexDirection: 'column', alignItems: 'stretch', gap: '2px' } },
            h('strong', null, t('invoke.help')),
            h('span', { className: 'mcp-hint' }, t('invoke.helpDesc')),
          ),
          h(
            'div',
            { className: 'mcp-card-body' },
            COMMAND_HELP.map((line) =>
              h(
                'div',
                { className: 'mcp-code', key: line },
                h('code', null, line),
                h(
                  Button,
                  { size: 'is-sm', variant: 'is-ghost', onClick: () => copy(line) },
                  copied === line ? t('action.copied') : t('action.copy'),
                ),
              ),
            ),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Drawer: create / edit / import / marketplace quick add
    // -----------------------------------------------------------------------

    function AddDrawer({ state, environment, marketplace, store, onClose, onDone }) {
      const editing = state.mode === 'edit' ? state.server : null
      const marketEntry = state.mode === 'market' ? state.entry : null
      const [tab, setTab] = React.useState(
        state.mode === 'import' ? 'import' : state.mode === 'market' ? 'manual' : 'manual',
      )
      const [importText, setImportText] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [previewBusy, setPreviewBusy] = React.useState(false)
      const [form, setForm] = React.useState(() => initialForm(editing, marketEntry))
      const [fieldValues, setFieldValues] = React.useState(() => initialFields(marketEntry))
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }))

      const submit = async () => {
        setError(null)
        if (editing) {
          const patch = buildPatch(form, editing)
          if (Object.keys(patch).length === 0) {
            onDone()
            return
          }
          try {
            await store.run('save', 'update', { id: editing.id, patch }, t('notice.saved'))
            onDone()
          } catch (failure) {
            setError(failure.message)
          }
          return
        }
        const validation = validateForm(form, marketEntry, fieldValues)
        if (validation) {
          setError(validation)
          return
        }
        if (marketEntry) {
          const missing = (marketEntry.requirements ?? [])
            .map((requirement) => evaluateRequirement(requirement, environment))
            .filter((requirement) => requirement.hard && !requirement.met)
          if (missing.length > 0 && !acknowledged) {
            setError(`${t('market.missing')}: ${missing.map((item) => item.label).join(', ')}`)
            return
          }
        }
        try {
          if (marketEntry) {
            await store.run(
              'create',
              'create',
              {
                json: {
                  serverName: marketEntry.id,
                  title: localized(marketEntry.title) || marketEntry.id,
                  description: localized(marketEntry.summary),
                  transport: marketEntry.transport,
                  command: marketEntry.command ?? undefined,
                  args: marketEntry.args ?? undefined,
                  env: marketEntry.env ?? undefined,
                  url: marketEntry.url ?? undefined,
                  headers: marketEntry.headers ?? undefined,
                  marketId: marketEntry.id,
                  mode: form.mode,
                  scope: form.scope,
                },
                fields: fieldValues,
              },
              t('notice.created'),
            )
          } else {
            await store.run(
              'create',
              'create',
              {
                name: form.name,
                title: form.title || form.name,
                transport: form.transport,
                command: form.command,
                args: form.argsText,
                cwd: form.cwd,
                url: form.url,
                env: rowsToMap(form.envRows),
                headers: rowsToMap(form.headerRows),
                mode: form.mode,
                scope: form.scope,
              },
              t('notice.created'),
            )
          }
          onDone()
        } catch (failure) {
          setError(failure.message)
        }
      }

      const runPreview = async () => {
        setPreviewBusy(true)
        setError(null)
        try {
          const body = await postAction('preview', { json: importText })
          setPreview(body)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setPreviewBusy(false)
        }
      }

      const createImported = async () => {
        setError(null)
        try {
          await store.run('create', 'create', { json: importText }, t('notice.created'))
          onDone()
        } catch (failure) {
          setError(failure.message)
        }
      }

      const title = editing
        ? `${t('drawer.edit')} · ${editing.title || editing.id}`
        : marketEntry
          ? `${t('drawer.marketAdd')} · ${localized(marketEntry.title)}`
          : t('drawer.create')

      return h(
        'div',
        {
          className: 'mcp-drawer-backdrop',
          role: 'presentation',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'aside',
          { className: 'mcp-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h(
            'div',
            { className: 'mcp-drawer-head' },
            h('h2', null, title),
            h(Button, { size: 'is-sm', variant: 'is-ghost', onClick: onClose, title: t('action.cancel') }, '✕'),
          ),
          !editing && !marketEntry
            ? h(
                'nav',
                { className: 'mcp-tabs', role: 'tablist', style: { padding: '0 18px' } },
                [
                  ['manual', t('drawer.manual')],
                  ['import', t('drawer.import')],
                ].map(([id, label]) =>
                  h(
                    'button',
                    {
                      key: id,
                      type: 'button',
                      className: `mcp-tab${tab === id ? ' is-active' : ''}`,
                      onClick: () => setTab(id),
                    },
                    label,
                  ),
                ),
              )
            : null,
          h(
            'div',
            { className: 'mcp-drawer-body' },
            error ? h('div', { className: 'mcp-result is-err' }, error) : null,
            tab === 'import' && !editing && !marketEntry
              ? h(
                  React.Fragment,
                  null,
                  h(Field, { label: t('import.title'), hint: t('import.hint') }, h('textarea', {
                    className: 'mcp-textarea',
                    style: { minHeight: '200px' },
                    value: importText,
                    placeholder: t('import.placeholder'),
                    spellCheck: false,
                    onChange: (event) => setImportText(event.target.value),
                  })),
                  h(
                    'div',
                    { className: 'mcp-row' },
                    h(Button, { size: 'is-sm', busy: previewBusy, onClick: runPreview }, t('action.preview')),
                  ),
                  preview
                    ? h(
                        'div',
                        { className: 'mcp-section' },
                        h('h4', null, t('import.preview')),
                        preview.errors?.length
                          ? h('div', { className: 'mcp-result is-err' }, preview.errors.join('\n'))
                          : null,
                        (preview.candidates ?? []).length === 0
                          ? h('div', { className: 'mcp-hint' }, t('import.none'))
                          : h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                              preview.candidates.map((candidate, index) =>
                                h(
                                  'div',
                                  { className: 'mcp-tool', key: index },
                                  h(
                                    'div',
                                    { className: 'mcp-row' },
                                    h('span', { className: 'mcp-tool-name' }, candidate.id),
                                    candidate.draft
                                      ? h(Badge, { tone: 'is-ok' }, candidate.draft.transport)
                                      : h(Badge, { tone: 'is-err' }, t('badge.error')),
                                  ),
                                  candidate.errors?.length
                                    ? h('div', { className: 'mcp-tool-desc' }, candidate.errors.join('; '))
                                    : null,
                                  (candidate.warnings ?? []).length
                                    ? h('div', { className: 'mcp-hint' }, candidate.warnings.join('; '))
                                    : null,
                                ),
                              ),
                            ),
                      )
                    : null,
                )
              : h(
                  React.Fragment,
                  null,
                  marketEntry
                    ? h(MarketFields, {
                        entry: marketEntry,
                        values: fieldValues,
                        onChange: setFieldValues,
                        environment,
                        acknowledged,
                        onAcknowledge: setAcknowledged,
                      })
                    : null,
                  h(ServerFormFields, {
                    form,
                    setValue,
                    editing,
                    isMarket: Boolean(marketEntry),
                    setForm,
                  }),
                ),
          ),
          h(
            'div',
            { className: 'mcp-drawer-foot' },
            h(Button, { onClick: onClose }, t('action.cancel')),
            tab === 'import' && !editing && !marketEntry
              ? h(
                  Button,
                  {
                    variant: 'is-primary',
                    busy: store.busy === 'create',
                    disabled: !preview || (preview.candidates ?? []).length === 0,
                    onClick: createImported,
                  },
                  t('import.createAll'),
                )
              : h(
                  Button,
                  { variant: 'is-primary', busy: store.busy === 'create' || store.busy === 'save', onClick: submit },
                  editing ? t('action.save') : t('action.create'),
                ),
          ),
        ),
      )
    }

    /** @returns {Record<string, any>} a fresh form state. */
    function initialForm(editing, marketEntry) {
      const server = editing ?? null
      if (server) {
        return {
          name: server.id,
          title: server.title ?? '',
          transport: server.transport,
          command: server.command ?? '',
          argsText: (server.args ?? []).join('\n'),
          cwd: server.cwd ?? '',
          url: server.url ?? '',
          envRows: (server.env ?? []).map((entry) => ({ key: entry.key, value: '', masked: entry.masked, secret: true })),
          headerRows: (server.headers ?? []).map((entry) => ({
            key: entry.key,
            value: '',
            masked: entry.masked,
            secret: true,
          })),
          timeout: server.toolCallTimeoutMs ? String(server.toolCallTimeoutMs) : '',
          mode: server.mode,
          scope: server.scope,
        }
      }
      return {
        name: marketEntry ? marketEntry.id : '',
        title: marketEntry ? localized(marketEntry.title) : '',
        transport: marketEntry ? marketEntry.transport : 'stdio',
        command: marketEntry?.command ?? 'npx',
        argsText: (marketEntry?.args ?? []).join('\n'),
        cwd: '',
        url: marketEntry?.url ?? '',
        envRows: marketEntry?.env
          ? Object.entries(marketEntry.env).map(([key, value]) => ({ key, value: String(value), secret: true }))
          : [],
        headerRows: marketEntry?.headers
          ? Object.entries(marketEntry.headers).map(([key, value]) => ({ key, value: String(value), secret: true }))
          : [],
        timeout: '',
        mode: 'auto',
        scope: { kind: 'all', workspaceIds: [], sessionIds: [] },
      }
    }

    /** @returns {Record<string, string>} initial values for a marketplace entry's fields. */
    function initialFields(marketEntry) {
      const values = {}
      for (const field of marketEntry?.fields ?? []) values[field.key] = field.default ?? ''
      return values
    }

    /** @returns {string|null} a validation message, or null. */
    function validateForm(form, marketEntry, fieldValues) {
      if (!marketEntry) {
        if (!form.name.trim()) return t('form.name')
        if (!NAME_RE.test(form.name.trim())) return t('form.nameHint')
      }
      if (form.transport === 'stdio' && !String(form.command ?? '').trim()) return t('form.command')
      if (form.transport === 'streamable-http' && !String(form.url ?? '').trim()) return t('form.url')
      const missing = (marketEntry?.fields ?? []).filter(
        (field) => field.required && !String(fieldValues?.[field.key] ?? '').trim(),
      )
      if (missing.length > 0) {
        return `${t('form.required')}: ${missing.map((field) => localized(field.label) || field.key).join(', ')}`
      }
      return null
    }

    /** @returns {Record<string, unknown>} the update patch for an edited server. */
    function buildPatch(form, server) {
      const patch = {}
      if (form.title.trim() && form.title.trim() !== server.title) patch.title = form.title.trim()
      if (form.transport !== server.transport) patch.transport = form.transport
      if (form.transport === 'stdio') {
        if ((form.command ?? '') !== (server.command ?? '')) patch.command = form.command
        const nextArgs = splitArgs(form.argsText)
        if (JSON.stringify(nextArgs) !== JSON.stringify(server.args ?? [])) patch.args = nextArgs
        if ((form.cwd ?? '') !== (server.cwd ?? '')) patch.cwd = form.cwd
      } else if ((form.url ?? '') !== (server.url ?? '')) {
        patch.url = form.url
      }
      const env = changedRows(form.envRows)
      if (Object.keys(env).length > 0) patch.env = env
      const headers = changedRows(form.headerRows)
      if (Object.keys(headers).length > 0) patch.headers = headers
      const timeout = form.timeout ? Number(form.timeout) : null
      if (timeout !== (server.toolCallTimeoutMs ?? null)) patch.toolCallTimeoutMs = timeout
      if (form.mode !== server.mode) patch.mode = form.mode
      return patch
    }

    /** @returns {Record<string, string|null>} only rows the user actually changed. */
    function changedRows(rows) {
      const out = {}
      for (const row of rows) {
        if (!row.key) continue
        if (row.value === '' && row.masked !== undefined) continue
        out[row.key] = row.value
      }
      return out
    }

    /** @returns {Record<string, string>} rows to a plain map. */
    function rowsToMap(rows) {
      const out = {}
      for (const row of rows) {
        if (row.key) out[row.key] = row.value
      }
      return out
    }

    /** @returns {string[]} argument lines to a vector. */
    function splitArgs(text) {
      return String(text ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    }

    function ServerFormFields({ form, setValue, editing, isMarket, setForm }) {
      const transportOptions = [
        { value: 'stdio', label: t('badge.stdio') },
        { value: 'streamable-http', label: t('badge.http') },
      ]
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'mcp-grid-2' },
          h(
            Field,
            { label: t('form.name'), hint: isMarket ? undefined : t('form.nameHint'), required: !isMarket },
            h('input', {
              className: 'mcp-input mcp-mono',
              value: form.name,
              disabled: Boolean(editing) || isMarket,
              spellCheck: false,
              onChange: (event) => setValue('name', event.target.value),
            }),
          ),
          h(
            Field,
            { label: t('form.title') },
            h('input', {
              className: 'mcp-input',
              value: form.title,
              onChange: (event) => setValue('title', event.target.value),
            }),
          ),
        ),
        h(
          Field,
          { label: t('form.transport') },
          h(Segmented, {
            value: form.transport,
            options: transportOptions,
            onChange: (value) => setValue('transport', value),
          }),
        ),
        form.transport === 'stdio'
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'mcp-grid-2' },
                h(
                  Field,
                  { label: t('form.command'), hint: t('form.commandHint'), required: true },
                  h('input', {
                    className: 'mcp-input mcp-mono',
                    value: form.command,
                    spellCheck: false,
                    onChange: (event) => setValue('command', event.target.value),
                  }),
                ),
                h(
                  Field,
                  { label: t('form.cwd') },
                  h('input', {
                    className: 'mcp-input mcp-mono',
                    value: form.cwd,
                    spellCheck: false,
                    onChange: (event) => setValue('cwd', event.target.value),
                  }),
                ),
              ),
              h(
                Field,
                { label: t('form.args'), hint: t('form.argsHint') },
                h('textarea', {
                  className: 'mcp-textarea',
                  value: form.argsText,
                  spellCheck: false,
                  onChange: (event) => setValue('argsText', event.target.value),
                }),
              ),
              h(
                Field,
                { label: t('form.env'), hint: t('form.envHint') },
                h(KeyValueEditor, {
                  rows: form.envRows,
                  keepHint: t('form.keep'),
                  onChange: (rows) => setValue('envRows', rows),
                }),
              ),
            )
          : h(
              React.Fragment,
              null,
              h(
                Field,
                { label: t('form.url'), required: true },
                h('input', {
                  className: 'mcp-input mcp-mono',
                  value: form.url,
                  spellCheck: false,
                  placeholder: 'https://example.com/mcp',
                  onChange: (event) => setValue('url', event.target.value),
                }),
              ),
              h(
                Field,
                { label: t('form.headers'), hint: t('form.envHint') },
                h(KeyValueEditor, {
                  rows: form.headerRows,
                  keepHint: t('form.keep'),
                  onChange: (rows) => setValue('headerRows', rows),
                }),
              ),
            ),
        h(
          Field,
          { label: t('form.timeout') },
          h('input', {
            className: 'mcp-input mcp-mono',
            value: form.timeout,
            inputMode: 'numeric',
            placeholder: '60000',
            onChange: (event) => setValue('timeout', event.target.value.replace(/[^0-9]/g, '')),
          }),
        ),
        h(
          Field,
          { label: t('mode.label'), hint: form.mode === 'auto' ? t('mode.autoHint') : t('mode.manualHint') },
          h(Segmented, {
            value: form.mode,
            options: [
              { value: 'auto', label: t('mode.auto') },
              { value: 'manual', label: t('mode.manual') },
            ],
            onChange: (value) => setValue('mode', value),
          }),
        ),
      )
    }

    function MarketFields({ entry, values, onChange, environment, acknowledged, onAcknowledge }) {
      const requirements = (entry.requirements ?? []).map((requirement) => evaluateRequirement(requirement, environment))
      const missing = requirements.filter((requirement) => requirement.hard && !requirement.met)
      return h(
        'div',
        { className: 'mcp-section' },
        h('h4', null, t('market.fields')),
        entry.summary ? h('div', { className: 'mcp-hint' }, localized(entry.summary)) : null,
        requirements.length > 0
          ? h(
              'div',
              { className: 'mcp-market-tags' },
              requirements.map((requirement, index) =>
                h(
                  Badge,
                  {
                    key: index,
                    tone: requirement.met ? (requirement.warn ? 'is-warn' : requirementTone(requirement)) : 'is-warn',
                  },
                  `${requirementPrefix(requirement)}${requirement.label}${requirement.met ? '' : ` · ${t('market.missing')}`}`,
                ),
              ),
            )
          : null,
        missing.length > 0
          ? h(
              'label',
              { className: 'mcp-check' },
              h('input', {
                type: 'checkbox',
                checked: acknowledged === true,
                onChange: (event) => onAcknowledge?.(event.target.checked),
              }),
              h('span', null, `${t('market.missing')}: ${missing.map((item) => item.label).join(', ')} — ${t('market.forceAdd')}`),
            )
          : null,
        (entry.fields ?? []).map((field) =>
          h(
            Field,
            {
              key: field.key,
              label: `${localized(field.label) || field.key}`,
              required: field.required === true,
              hint: [localized(field.hint), field.secret ? t('form.envHint') : null].filter(Boolean).join(' '),
            },
            h('input', {
              className: 'mcp-input mcp-mono',
              type: field.secret ? 'password' : 'text',
              value: values[field.key] ?? '',
              placeholder: field.placeholder ?? '',
              spellCheck: false,
              onChange: (event) => onChange({ ...values, [field.key]: event.target.value }),
            }),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Panellist icon
    // -----------------------------------------------------------------------

    /**
     * Sidebar icon: two connected nodes over a plug — "an MCP server plugged in".
     * @param {{ size: number, active: boolean }} props - owner props.
     * @returns {any} element.
     */
    function McpPanelIcon({ size }) {
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M6.1 2.4v3.1M9.9 2.4v3.1' }),
        h('path', { d: 'M4.6 5.5h6.8v2.2a3.4 3.4 0 0 1-3.4 3.4 3.4 3.4 0 0 1-3.4-3.4z' }),
        h('path', { d: 'M8 11.1v2.5' }),
        h('path', { d: 'M6.6 13.6h2.8' }),
      )
    }

    // -----------------------------------------------------------------------
    // Plugin
    // -----------------------------------------------------------------------

    /**
     * Mount the MCP Center surfaces.
     * @param {any} ctx - browser plugin context.
     * @returns {() => void} disposer.
     */
    function apply(ctx) {
      const disposers = []
      try {
        disposers.push(
          ctx.locale.register(NS, {
            zh: ZH,
            en: EN,
          }),
        )
      } catch (error) {
        console.error('[dsh-mcp-center] locale registration failed', error)
      }
      try {
        runtime.t = ctx.locale.bind(NS)
        runtime.locale = () => {
          try {
            const active = ctx.locale.getLocale()?.active ?? 'zh'
            return String(active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
          } catch {
            return 'zh'
          }
        }
        runtime.subscribe = (listener) => ctx.locale.subscribe(listener)
      } catch (error) {
        console.error('[dsh-mcp-center] locale binding failed', error)
      }
      runtime.selectPanel = (panelId) => {
        try {
          ctx.get('layout')?.selectPanel?.(panelId)
        } catch {
          /* the shell may not expose layout yet */
        }
      }

      const slots = ctx.slots
      disposers.push(
        slots.inject('sidebar.panellist', () =>
          slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: () => t('title'),
            },
            McpPanelIcon,
          ),
        ),
      )
      disposers.push(
        slots.inject('main', () =>
          slots.register(
            {
              name: 'main',
              key: PANEL_ID,
            },
            McpPage,
          ),
        ),
      )

      return () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose?.()
          } catch (error) {
            console.error('[dsh-mcp-center] dispose failed', error)
          }
        }
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      /**
       * Internal surface for the offline render smoke test
       * (`scratch/client-smoke`). The module loader only reads `inject` and
       * `apply`, so this is inert in the page; it exists so component render
       * paths can be exercised without a browser.
       */
      __test: {
        McpPage,
        ConfiguredTab,
        ServerCard,
        ScopeEditor,
        MarketTab,
        MarketCard,
        InvokeTab,
        AddDrawer,
        evaluateRequirement,
        localized,
        t,
        CSS,
      },
    }
  },
})
