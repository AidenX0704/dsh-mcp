/**
 * Render smoke test for the dsh-mcp-center Client half.
 *
 * Loads `client.js` exactly as the browser module table does, then renders the
 * registered panel page and every visual state with a minimal React stub. This
 * is not a DOM test: it executes the real component functions so undefined
 * reads, broken prop shapes and crashes in a rarely used tab fail here instead
 * of blanking the slot inside the running app.
 *
 * Run: node test/client-smoke.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const CLIENT = path.join(REPO, 'client.js')

let failures = 0
/** @param {boolean} condition @param {string} label @param {unknown} [detail] */
function check(condition, label, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${label}`, detail === undefined ? '' : detail)
}

// ---------------------------------------------------------------------------
// Minimal React: element tree, initial hook state, no re-render loop
// ---------------------------------------------------------------------------

const FRAGMENT = Symbol('Fragment')
/** Hook values the next render should start with (test control of useState). */
let hookOverrides = []
let hookCursor = 0
const React = {
  Fragment: FRAGMENT,
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  useState(initial) {
    const index = hookCursor
    hookCursor += 1
    if (index in hookOverrides) return [hookOverrides[index], () => {}]
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  useRef(initial) {
    return { current: typeof initial === 'function' ? initial() : initial }
  },
}

/**
 * Render an element tree to text.
 * @param {any} node - element tree.
 * @param {string[]} [out] - accumulator.
 * @returns {string} rendered text plus selected inline attributes.
 */
function render(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out.join('')
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out.join('')
  }
  if (Array.isArray(node)) {
    for (const child of node) render(child, out)
    return out.join('')
  }
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length > 0) {
      props.children = node.children.length === 1 ? node.children[0] : node.children
    }
    return render(node.type(props), out)
  }
  if (node.type === FRAGMENT) return render(node.children, out)
  if (node.type === 'style') return out.join('')
  if (typeof node.type === 'string') {
    const attrs = node.props ?? {}
    for (const key of ['data-dsh-panel-entry', 'data-dsh-mcp-center-view', 'role', 'aria-selected']) {
      if (attrs[key] !== undefined) out.push(`[${key}=${attrs[key]}]`)
    }
    if (['input', 'textarea', 'select'].includes(node.type)) {
      if (attrs.value !== undefined) out.push(`[value=${String(attrs.value)}]`)
      if (attrs.placeholder !== undefined) out.push(`[placeholder=${String(attrs.placeholder)}]`)
      if (node.type === 'select' && node.children.length > 0) {
        for (const child of node.children) render(child, out)
        return out.join('')
      }
    }
  }
  for (const child of node.children) render(child, out)
  return out.join('')
}

/**
 * Render one component with controlled initial hook state.
 * @param {any} component - function component.
 * @param {Record<string, unknown>} props - props.
 * @param {unknown[]} [overrides] - initial hook values.
 * @returns {string} rendered text.
 */
function renderWith(component, props, overrides = []) {
  hookOverrides = overrides
  hookCursor = 0
  const html = render(React.createElement(component, props))
  hookOverrides = []
  return html
}

// ---------------------------------------------------------------------------
// Load the client bundle the way the module table does
// ---------------------------------------------------------------------------

let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      registered = registration
    },
  },
}
new Function('window', fs.readFileSync(CLIENT, 'utf8'))(globalThis.window)
check(registered !== null, 'client bundle registers a module factory')
check(registered?.id === 'dsh-mcp-center', 'module id matches the package name', registered?.id)

const dictionaries = {}
const localeService = {
  register(ns, dicts) {
    dictionaries[ns] = dicts
    return () => {}
  },
  bind(ns) {
    return (key) => dictionaries[ns]?.zh?.[key] ?? key
  },
  getLocale() {
    return { active: 'zh' }
  },
  subscribe() {
    return () => {}
  },
}

/** @type {Array<{ slot: string, options: any, component: any }>} */
const slots = []
const plugin = registered.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require: ${specifier}`)
})
check(Array.isArray(plugin.inject), 'plugin declares inject')
check(plugin.inject.includes('slots') && plugin.inject.includes('locale'), 'plugin injects slots and locale')

const dispose = plugin.apply({
  locale: localeService,
  slots: {
    inject(slot, callback) {
      const registration = callback()
      slots.push({ slot, options: registration.options, component: registration.component })
      return () => {}
    },
    register(options, component) {
      return { options, component }
    },
  },
  get(name) {
    return name === 'layout' ? { selectPanel() {} } : undefined
  },
})
check(typeof dispose === 'function', 'apply returns a disposer')

console.log('\nregistrations')
const panellist = slots.find((entry) => entry.slot === 'sidebar.panellist')
const main = slots.find((entry) => entry.slot === 'main')
check(Boolean(panellist), 'sidebar panellist entry registered')
check(panellist?.options?.id === 'mcp', 'panel id is "mcp"', panellist?.options?.id)
check(panellist?.options?.order === 40, 'panel order sits after the skill center (30)', panellist?.options?.order)
check(panellist?.options?.label?.() === 'MCP 管理', 'panel label is localized', panellist?.options?.label?.())
check(main?.options?.key === 'mcp', 'main panel key matches the sidebar id', main?.options?.key)
check(typeof main?.component === 'function', 'main panel receives a component')

const iconHtml = render(React.createElement(panellist.component, { size: 16, active: false }))
check(iconHtml.includes('[data-dsh-panel-entry=mcp]'), 'icon exposes the panel entry anchor', iconHtml)
check(iconHtml.includes('svg') === false, 'icon renders an svg element, not text')

const internals = plugin.__test
check(internals && typeof internals.McpPage === 'function', 'internal components exposed for the smoke test')
checksThemeTokens()

/** The stylesheet must stay on host theme tokens. */
function checksThemeTokens() {
  const css = internals.CSS
  check(/--dsw-alias-bg-base/.test(css), 'stylesheet uses alias background tokens')
  check(/--dsw-alias-label-secondary/.test(css), 'stylesheet uses alias label tokens')
  const literalHex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  check(literalHex.length === 0, 'no literal hex colors in the stylesheet', literalHex)
  const rgba = css.match(/rgba?\(/g) ?? []
  check(rgba.length === 0, 'no literal rgb/rgba colors in the stylesheet', rgba)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const environment = {
  platform: 'windows',
  node: 'v22.17.0',
  python: 'Python 3.12.0',
  uv: null,
  docker: null,
  hasNode: true,
  hasPython: true,
  hasUv: false,
  hasDocker: false,
  oauthSupport: false,
  workspaces: [
    { id: 'ws-a', title: 'project-a', path: 'C:/work/project-a', sessionIds: ['session-a'] },
    { id: 'ws-b', title: 'project-b', path: 'C:/work/project-b', sessionIds: [] },
  ],
  sessions: [
    { id: 'session-a', cwd: 'C:/work/project-a', createdAt: 1, workspaceId: 'ws-a' },
    { id: 'session-b', cwd: 'C:/work/project-b', createdAt: 2, workspaceId: null },
  ],
  dataDir: 'C:/Users/Administrator/.dsh/mcp-center',
  demoServer: { name: 'demo', command: 'node', args: ['demo-server.mjs'] },
  version: '0.1.0',
}

const toolList = [
  { name: 'mcp__demo__echo', rawName: 'echo', description: 'Echo text', parameters: { type: 'object' } },
  { name: 'mcp__demo__add', rawName: 'add', description: 'Add numbers', parameters: { type: 'object' } },
]

/** @param {Record<string, unknown>} [overrides] */
function server(overrides = {}) {
  return {
    id: 'demo',
    title: '演示服务器',
    description: '',
    origin: 'managed',
    marketId: 'demo',
    transport: 'stdio',
    command: 'node',
    args: ['demo-server.mjs'],
    cwd: null,
    url: null,
    env: [{ key: 'TOKEN', set: true, masked: 'abc••••zz', external: false }],
    headers: [],
    toolCallTimeoutMs: null,
    enabled: true,
    mode: 'auto',
    scope: { kind: 'all', workspaceIds: [], sessionIds: [] },
    status: { phase: 'ready', message: '', updatedAt: 1 },
    tools: toolList,
    toolCount: toolList.length,
    rowId: 'mcp-center-demo',
    bundleName: '@dsh-mcp-center/server-demo',
    createdAt: 1,
    updatedAt: 1,
    reachable: true,
    ...overrides,
  }
}

const marketplace = {
  version: 1,
  generatedAt: '2026-11-03',
  categories: [
    { id: 'official', title: { zh: '官方参考', en: 'Official' } },
    { id: 'dev', title: { zh: '开发工具', en: 'Developer' } },
  ],
  servers: [
    {
      id: 'filesystem',
      title: { zh: '文件系统', en: 'Filesystem' },
      summary: { zh: '读写本机目录。', en: 'Read and write directories.' },
      category: 'official',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${DIR}'],
      env: {},
      headers: {},
      fields: [
        {
          key: 'DIR',
          label: { zh: '允许访问的目录', en: 'Allowed directory' },
          hint: { zh: '只能访问这个目录', en: 'Only this directory' },
          placeholder: 'C:\\data',
          secret: false,
          required: true,
          default: '',
        },
      ],
      requirements: [{ kind: 'node', hard: true, detail: { zh: '需要 Node.js 20+', en: 'Needs Node.js 20+' } }],
      auth: 'none',
      docs: 'https://example.test/fs',
      tags: ['files'],
      verifiedAt: '2026-11-03',
    },
    {
      id: 'context7',
      title: { zh: 'Context7', en: 'Context7' },
      summary: { zh: '最新文档检索。', en: 'Up-to-date docs.' },
      category: 'dev',
      transport: 'streamable-http',
      url: 'https://mcp.context7.com/mcp',
      env: {},
      headers: { Authorization: 'Bearer ${API_KEY}' },
      fields: [
        {
          key: 'API_KEY',
          label: { zh: 'API Key', en: 'API key' },
          secret: true,
          required: true,
          placeholder: 'ctx7_...',
          default: '',
        },
      ],
      requirements: [
        { kind: 'api-key', hard: false, detail: { zh: '需要密钥', en: 'Needs a key' } },
        { kind: 'docker', hard: true, detail: { zh: '需要 Docker', en: 'Needs Docker' } },
      ],
      auth: 'api-key',
      docs: 'https://example.test/ctx7',
      tags: ['docs'],
      verifiedAt: '2026-11-03',
    },
  ],
}

/** @param {Record<string, unknown>} [data] */
function storeFor(data = null) {
  return {
    data,
    busy: '',
    error: null,
    notice: null,
    notify() {},
    reload: async () => {},
    run: async () => ({ ok: true }),
  }
}

const fullState = {
  ok: true,
  version: '0.1.0',
  servers: [
    server(),
    server({
      id: 'github',
      title: 'GitHub',
      origin: 'external',
      transport: 'streamable-http',
      command: null,
      url: 'https://api.githubcopilot.com/mcp/',
      mode: 'manual',
      scope: { kind: 'workspace', workspaceIds: ['ws-a'], sessionIds: [] },
      tools: [{ name: 'mcp__github__create_issue', rawName: 'create_issue', description: 'Issue', parameters: {} }],
      toolCount: 1,
    }),
    server({
      id: 'broken',
      title: 'broken',
      enabled: false,
      status: { phase: 'error', message: 'command not found: npx', updatedAt: 1 },
      tools: [],
      toolCount: 0,
    }),
  ],
  marketplace,
  environment,
  counts: { configured: 3, enabled: 2, manual: 1, tools: 3 },
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

console.log('\npanel page')
const emptyPage = render(
  React.createElement(internals.McpPage, {
    children: null,
    store: storeFor({ ...fullState, servers: [], counts: { configured: 0, enabled: 0, manual: 0, tools: 0 } }),
  }),
)
check(emptyPage.includes('MCP 管理'), 'page title renders')
check(emptyPage.includes('已配置') && emptyPage.includes('市场') && emptyPage.includes('调用'), 'three tabs render')
check(emptyPage.includes('[data-dsh-mcp-center-view=]'), 'page exposes its data attribute', emptyPage.slice(0, 160))

const loadedPage = renderWith(internals.McpPage, { children: null })
check(loadedPage.includes('MCP 管理'), 'page renders its title')
check(loadedPage.includes('正在读取 MCP 配置'), 'page starts in the loading state (the store owns its own fetch)')

console.log('\nconfigured tab')
const configured = renderWith(internals.ConfiguredTab, {
  servers: fullState.servers,
  environment,
  busy: '',
  store: storeFor(fullState),
  onEdit() {},
  onAdd() {},
  onImport() {},
  onGoMarket() {},
})
check(configured.includes('已配置'), 'stats render')
check(configured.includes('演示服务器'), 'server title renders')
check(configured.includes('已连接'), 'connected status badge renders')
check(configured.includes('命令调用'), 'manual mode badge renders')
check(configured.includes('外部配置'), 'external server badge renders')
check(configured.includes('command not found: npx'), 'error status message renders')

const emptyConfigured = renderWith(internals.ConfiguredTab, {
  servers: [],
  environment,
  busy: '',
  store: storeFor({ ...fullState, servers: [] }),
  onEdit() {},
  onAdd() {},
  onImport() {},
  onGoMarket() {},
})
check(emptyConfigured.includes('还没有配置 MCP 服务器'), 'empty state renders')
check(emptyConfigured.includes('添加服务器'), 'empty state offers a CTA')

const expandedCard = renderWith(
  internals.ServerCard,
  { server: server(), environment, busy: '', store: storeFor(fullState), onEdit() {} },
  [true, false, false],
)
check(expandedCard.includes('mcp__demo__echo'), 'tool names render once the card is expanded', expandedCard.slice(0, 200))
check(expandedCard.includes('/mcp call'), 'manual invocation hint renders in the expanded card')
check(expandedCard.includes('自动') && expandedCard.includes('手动'), 'invocation mode control renders')

console.log('\nserver card variants')
for (const [label, overrides] of [
  ['ready', {}],
  ['manual', { mode: 'manual' }],
  ['disabled', { enabled: false }],
  ['pending', { status: { phase: 'pending', message: 'no tools yet' }, tools: [], toolCount: 0 }],
  ['error', { status: { phase: 'error', message: 'boom' }, tools: [], toolCount: 0 }],
  ['http', { transport: 'streamable-http', command: null, args: [], url: 'https://example.test/mcp' }],
  ['external', { origin: 'external' }],
]) {
  const html = render(
    React.createElement(internals.ServerCard, {
      server: server(overrides),
      environment,
      busy: '',
      store: storeFor(fullState),
      onEdit() {},
    }),
  )
  check(html.includes('演示服务器'), `server card renders (${label})`)
}

const scopeHtml = render(
  React.createElement(internals.ScopeEditor, {
    server: server({ scope: { kind: 'workspace', workspaceIds: ['ws-a'], sessionIds: [] } }),
    environment,
    store: storeFor(fullState),
  }),
)
check(scopeHtml.includes('project-a'), 'scope editor lists workspaces')
check(scopeHtml.includes('保存范围'), 'scope editor offers save')

console.log('\nmarketplace tab')
const marketHtml = render(
  React.createElement(internals.MarketTab, {
    marketplace,
    environment,
    configuredIds: new Set(['filesystem']),
    store: storeFor(fullState),
    onAdd() {},
  }),
)
check(marketHtml.includes('文件系统'), 'market entries render')
check(marketHtml.includes('官方参考'), 'category chips render')
check(marketHtml.includes('需要密钥'), 'auth requirement renders')
check(marketHtml.includes('需要 Docker'), 'hard requirement renders')
check(marketHtml.includes('已配置'), 'configured entry is marked')

const marketCard = render(
  React.createElement(internals.MarketCard, {
    entry: marketplace.servers[1],
    environment,
    configured: false,
    onAdd() {},
  }),
)
check(marketCard.includes('Context7'), 'market card title renders')
check(marketCard.includes('本地进程') || marketCard.includes('远程 HTTP'), 'transport badge renders')

console.log('\ninvoke tab')
const invokeHtml = render(
  React.createElement(internals.InvokeTab, {
    servers: fullState.servers,
    environment,
    store: storeFor(fullState),
  }),
)
check(invokeHtml.includes('手动调用台'), 'manual console renders')
check(invokeHtml.includes('echo'), 'tool selector lists tools')
check(invokeHtml.includes('/mcp call'), 'command reference renders')

const invokeEmpty = render(
  React.createElement(internals.InvokeTab, { servers: [], environment, store: storeFor(fullState) }),
)
check(invokeEmpty.includes('先选择一个已连接的服务器'), 'empty console explains what to do')

console.log('\ndrawers')
const createDrawer = render(
  React.createElement(internals.AddDrawer, {
    state: { mode: 'create' },
    environment,
    marketplace,
    store: storeFor(fullState),
    onClose() {},
    onDone() {},
  }),
)
check(createDrawer.includes('添加 MCP 服务器'), 'create drawer renders')
check(createDrawer.includes('手动配置') && createDrawer.includes('导入 JSON'), 'create drawer has both entry paths')
check(createDrawer.includes('可执行命令'), 'manual form renders command field')

const marketDrawer = render(
  React.createElement(internals.AddDrawer, {
    state: { mode: 'market', entry: marketplace.servers[0] },
    environment,
    marketplace,
    store: storeFor(fullState),
    onClose() {},
    onDone() {},
  }),
)
check(marketDrawer.includes('快捷添加'), 'market drawer renders')
check(marketDrawer.includes('允许访问的目录'), 'marketplace field renders as an input')

const importDrawer = render(
  React.createElement(internals.AddDrawer, {
    state: { mode: 'import' },
    environment,
    marketplace,
    store: storeFor(fullState),
    onClose() {},
    onDone() {},
  }),
)
check(importDrawer.includes('导入 JSON'), 'import drawer renders')
check(importDrawer.includes('mcpServers'), 'import placeholder shows an example')

const editDrawer = render(
  React.createElement(internals.AddDrawer, {
    state: { mode: 'edit', server: server() },
    environment,
    marketplace,
    store: storeFor(fullState),
    onClose() {},
    onDone() {},
  }),
)
check(editDrawer.includes('编辑'), 'edit drawer renders')
check(editDrawer.includes('演示服务器'), 'edit drawer shows the server title')
check(editDrawer.includes('abc••••zz'), 'edit drawer shows the masked secret instead of the value')

console.log('\nEnglish locale')
const english = plugin.__test.localized({ zh: '中文', en: 'English' })
check(english === '中文', 'localized() prefers the active locale', english)

console.log('\nrequirement evaluation')
const evaluate = internals.evaluateRequirement
check(evaluate({ kind: 'node', detail: { zh: '需要 Node.js 24 或更高版本' } }, environment).warn === true, 'older local Node is a warning')
check(evaluate({ kind: 'node', detail: { zh: '需要 Node.js 18' } }, environment).warn === false, 'satisfied Node floor is not a warning')
check(evaluate({ kind: 'docker', hard: true, detail: { zh: '需要 Docker' } }, environment).met === false, 'missing Docker is unmet')
check(evaluate({ kind: 'oauth', hard: true, detail: { zh: '需要浏览器授权' } }, environment).met === false, 'OAuth requirement is unmet without an OAuth flow')
check(evaluate({ kind: 'uv', hard: true, detail: { zh: '需要 uv' } }, environment).met === false, 'missing uv is unmet')

console.log('\nsecond mount')
const slots2 = []
plugin.apply({
  locale: localeService,
  slots: {
    inject(slot, callback) {
      const registration = callback()
      slots2.push({ slot, ...registration })
      return () => {}
    },
    register(options, component) {
      return { options, component }
    },
  },
  get: () => undefined,
})
check(slots2.length === 2, 'a second mount re-registers both seats', slots2.length)
check(slots2.every((entry) => typeof entry.component === 'function'), 'both seats receive components')

dispose()
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
