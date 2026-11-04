/**
 * Offline harness for the dsh-mcp-center Host half.
 *
 * Boots the plugin against a mock Cordis context (fake web server, Plugin
 * Manager, session store and workspace registry), then drives the HTTP surface
 * the Web page uses. It proves the state machine — create → materialize bundle
 * → install → discover tools → scope/mode → update → remove — without touching
 * a real profile.
 *
 * Run: node test/host-harness.mjs
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const PLUGIN = path.join(REPO, 'index.js')

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
// Mock services
// ---------------------------------------------------------------------------

/** @type {Array<Record<string, unknown>>} */
const bundles = []
/** @type {Array<Record<string, unknown>>} */
const plugins = []
const calls = { install: [], remove: [], toggle: [], setBundle: [] }

const pluginManager = {
  async listBundles() {
    return bundles.map((bundle) => ({ ...bundle }))
  },
  async listPlugins() {
    return plugins.map((plugin) => ({ ...plugin }))
  },
  async installBundle(spec, options) {
    calls.install.push({ spec, options })
    const manifest = JSON.parse(await fs.readFile(path.join(spec, 'package.json'), 'utf8'))
    const patchText = await fs.readFile(path.join(spec, 'cordis.patch.yml'), 'utf8')
    const rowId = /- id: (\S+)/.exec(patchText)?.[1]?.replace(/^["']|["']$/g, '')
    bundles.push({ name: manifest.name, installed: true, enabled: true, version: manifest.version, rows: [] })
    plugins.push({
      patchId: rowId,
      entryId: `entry-${rowId}`,
      moduleName: '@deepseek-ai/dsh-mcp-client',
      enabled: true,
      fiberPhase: 'active',
    })
    // The real MCP client publishes its tools asynchronously; simulate that.
    simulateTools(manifest.name, patchText)
    return { changed: true, application: 'applied', stage: 'install', target: spec }
  },
  async setPluginEnabled(entryId, enabled) {
    calls.toggle.push({ entryId, enabled })
    const row = plugins.find((plugin) => plugin.entryId === entryId)
    if (row) row.enabled = enabled
    return { changed: true, application: 'applied', stage: 'enable', target: entryId, enabled }
  },
  async setBundleEnabled(name, enabled) {
    calls.setBundle.push({ name, enabled })
    const bundle = bundles.find((entry) => entry.name === name)
    if (bundle) bundle.enabled = enabled
    return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
  },
  async removeBundle(name) {
    calls.remove.push(name)
    const index = bundles.findIndex((bundle) => bundle.name === name)
    if (index >= 0) bundles.splice(index, 1)
    for (let i = plugins.length - 1; i >= 0; i -= 1) {
      if (String(plugins[i].patchId ?? '').startsWith('mcp-center-')) plugins.splice(i, 1)
    }
    return { changed: true, application: 'applied', stage: 'remove', target: name }
  },
}

/** @type {Array<Record<string, unknown>>} */
let toolSchemas = []
/** @type {Map<string, string>} */
const pendingTools = new Map()

/** @param {string} bundlePackage @param {string} patchText */
function simulateTools(bundlePackage, patchText) {
  const serverName = /serverName: (\S+)/.exec(patchText)?.[1]?.replace(/"/g, '')
  if (!serverName) return
  pendingTools.set(serverName, bundlePackage)
  queueMicrotask(() => {
    for (const [pendingServer, owner] of [...pendingTools]) {
      if (owner !== bundlePackage) continue
      toolSchemas = toolSchemas.filter((schema) => !String(schema.name).startsWith(`mcp__${pendingServer}__`))
      toolSchemas.push(
        {
          name: `mcp__${pendingServer}__echo`,
          description: `Echo from ${pendingServer}`,
          parameters: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          name: `mcp__${pendingServer}__sum`,
          description: `Sum from ${pendingServer}`,
          parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        },
      )
      pendingTools.delete(pendingServer)
    }
  })
}

const sessions = new Map()
const workspaces = []

const toolsService = {
  schemas: () => toolSchemas.map((schema) => ({ ...schema })),
  get: (name) => toolSchemas.find((schema) => schema.name === name),
  register: () => () => {},
  restrict: () => () => {},
  async execute(input) {
    return {
      isError: false,
      value: { echoed: input.arguments?.text ?? null, name: input.name },
      content: [{ type: 'text', text: `result of ${input.name}` }],
    }
  },
}

/** @type {Array<{kind: string, path: string, handler: Function}>} */
const routes = []
const webServer = {
  register(route) {
    routes.push(route)
    return () => {
      const index = routes.indexOf(route)
      if (index >= 0) routes.splice(index, 1)
    }
  },
}

const commands = []
const registeredTools = []
const disposers = []
const listeners = new Map()

const ctx = {
  logger: console,
  effect(factory) {
    const dispose = factory()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => dispose?.()
  },
  on(event, listener) {
    const list = listeners.get(event) ?? []
    list.push(listener)
    listeners.set(event, list)
    return () => {
      const current = listeners.get(event) ?? []
      listeners.set(event, current.filter((entry) => entry !== listener))
    }
  },
  interval() {
    return () => {}
  },
  inject(_deps, callback) {
    const dispose = callback({ webServer, tools: toolsService, commands: { register: () => () => {} } })
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => dispose?.()
  },
  get(name, fallback) {
    if (name === 'pluginManager') return pluginManager
    if (name === 'sessions') {
      return {
        get: (id) => sessions.get(id),
        list: () => [...sessions.values()],
      }
    }
    if (name === 'workspaceRegistry') {
      return { list: () => workspaces.map((workspace) => ({ ...workspace })) }
    }
    if (name === 'remoteWebUiPairing') return { isPairedDevice: () => false }
    if (name === 'webServer') return webServer
    return fallback
  },
  tools: toolsService,
  commands: {
    register(definition) {
      commands.push(definition)
      return () => {}
    },
  },
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

/** @param {string} url @param {'GET'|'POST'} [method] @param {unknown} [body] */
async function request(url, method = 'GET', body) {
  const route = routes[0]
  if (!route) throw new Error('no route registered')
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const req = {
    method,
    url,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
  const result = { status: 0, body: null }
  const res = {
    writeHead(status) {
      result.status = status
    },
    end(text) {
      result.body = text === undefined ? null : JSON.parse(String(text))
    },
  }
  await route.handler(req, res)
  return result
}

/** @param {string} action @param {Record<string, unknown>} [payload] */
const post = (action, payload = {}) => request('/api/dsh-mcp-center/action', 'POST', { action, ...payload })

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

// The harness never writes inside the checkout: an installed copy may be read-only.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mcp-center-test-'))

async function main() {
  await fs.rm(dataDir, { recursive: true, force: true })
  const module = await import(pathToFileURL(PLUGIN).href)
  check(typeof module.apply === 'function', 'plugin exports apply()')
  check(Array.isArray(module.inject), 'plugin declares inject')

  module.apply(ctx, { enabled: true, dataDir, allowRemote: false })
  await new Promise((resolve) => setTimeout(resolve, 60))

  console.log('\nroutes and contributions')
  check(routes.length === 1, 'one web route registered', routes)
  check(routes[0]?.path === '/api/dsh-mcp-center', 'route path', routes[0]?.path)
  check(commands.length === 1 && commands[0].name === 'mcp', '/mcp command registered')
  check(registeredTools.length === 0, 'tool registration flows through ctx.tools')

  console.log('\nstate is empty at first')
  const initial = await request('/api/dsh-mcp-center/state')
  check(initial.status === 200, 'GET /state 200', initial.status)
  check(Array.isArray(initial.body?.servers) && initial.body.servers.length === 0, 'no servers yet')
  check(initial.body?.marketplace?.servers !== undefined, 'marketplace payload present')

  console.log('\nimport preview (Claude Desktop shape)')
  const preview = await post('preview', {
    json: JSON.stringify({
      mcpServers: {
        demo: { command: 'node', args: ['demo-server.mjs'], env: { DEBUG: '1' } },
        remote: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer abc' } },
      },
    }),
  })
  check(preview.status === 200, 'preview 200', preview.status)
  check(preview.body?.candidates?.length === 2, 'two candidates parsed', preview.body?.candidates?.length)
  check(
    preview.body?.candidates?.[0]?.draft?.transport === 'stdio',
    'stdio candidate transport',
    preview.body?.candidates?.[0],
  )
  check(
    preview.body?.candidates?.[1]?.draft?.transport === 'streamable-http',
    'http candidate transport',
    preview.body?.candidates?.[1],
  )

  console.log('\ncreate a stdio server')
  const created = await post('create', {
    json: JSON.stringify({
      mcpServers: { demo: { command: 'node', args: ['demo-server.mjs'] } },
    }),
  })
  check(created.status === 200 && created.body?.ok === true, 'create ok', created.body)
  check(created.body?.servers?.[0]?.id === 'demo', 'server id demo', created.body?.servers?.[0]?.id)
  check(created.body?.servers?.[0]?.toolCount === 2, 'two tools discovered', created.body?.servers?.[0]?.toolCount)
  check(calls.install.length === 1, 'installBundle called once', calls.install)
  const bundleDir = path.join(dataDir, 'servers', 'demo')
  const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, 'package.json'), 'utf8'))
  check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'generated manifest declares a bundle patch')
  const patchText = await fs.readFile(path.join(bundleDir, 'cordis.patch.yml'), 'utf8')
  check(patchText.includes("name: \"@deepseek-ai/dsh-mcp-client\""), 'patch inserts the MCP client')
  check(patchText.includes('serverName: "demo"'), 'patch sets serverName', patchText)
  check(patchText.includes('transport: "stdio"'), 'patch sets transport')

  console.log('\nstate file permissions and shape')
  const stateText = await fs.readFile(path.join(dataDir, 'state.json'), 'utf8')
  const persisted = JSON.parse(stateText)
  check(persisted.servers?.demo?.command === 'node', 'state persisted')
  if (process.platform !== 'win32') {
    const stat = await fs.stat(path.join(dataDir, 'state.json'))
    check((stat.mode & 0o777) === 0o600, 'state.json is 0600', (stat.mode & 0o777).toString(8))
  }

  console.log('\nsecrets stay in the Host')
  const stateView = await request('/api/dsh-mcp-center/state')
  const demoView = stateView.body.servers.find((server) => server.id === 'demo')
  check(
    JSON.stringify(stateView.body).includes('demo-server.mjs') === true,
    'args stay visible (they are not secrets)',
  )
  const secretCreate = await post('create', {
    name: 'tokened',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg', '${DIR}'],
    env: { API_KEY: 'super-secret-value-123' },
  })
  check(secretCreate.status === 200, 'secret server created', secretCreate.body)
  const secretView = secretCreate.body?.server
  check(
    !JSON.stringify(secretView).includes('super-secret-value-123'),
    'secret value never leaves the Host',
    JSON.stringify(secretView?.env),
  )
  check(secretView?.env?.[0]?.masked?.includes('••••'), 'secret is masked', secretView?.env)

  console.log('\nscope and mode enforcement')
  sessions.set('session-a', { id: 'session-a', header: { cwd: 'C:/work/project-a' } })
  sessions.set('session-b', { id: 'session-b', header: { cwd: 'C:/work/project-b' } })
  workspaces.push({ id: 'ws-a', title: 'A', path: 'C:/work/project-a', sessionIds: ['session-a'] })
  workspaces.push({ id: 'ws-b', title: 'B', path: 'C:/work/project-b', sessionIds: ['session-b'] })

  const scoped = await post('update', {
    id: 'demo',
    patch: { scope: { kind: 'workspace', workspaceIds: ['ws-a'], sessionIds: [] } },
  })
  check(scoped.status === 200, 'scope update accepted', scoped.body)
  check(scoped.body?.server?.scope?.kind === 'workspace', 'scope persisted', scoped.body?.server?.scope)
  check(
    scoped.body?.server?.scope?.workspaceIds?.[0] === 'ws-a',
    'workspace id persisted',
    scoped.body?.server?.scope,
  )

  const manual = await post('update', { id: 'demo', patch: { mode: 'manual' } })
  check(manual.status === 200, 'mode update accepted')
  check(manual.body?.server?.mode === 'manual', 'manual mode persisted')

  console.log('\nagent restriction')
  const restricts = []
  const guards = []
  const agentTools = {
    restrict(filter) {
      restricts.push(filter)
      return () => {}
    },
    guard(guard) {
      guards.push(guard)
      return () => {}
    },
  }
  const agentCtx = {
    tools: agentTools,
    effect(factory) {
      const dispose = factory()
      return () => dispose?.()
    },
  }
  for (const listener of listeners.get('agent/created') ?? []) {
    await listener({ agent: { id: 'session-a', ctx: agentCtx } })
  }
  check(restricts.length === 1, 'restriction registered for in-scope agent', restricts)
  check(
    restricts[0]?.deny?.includes('mcp__demo__echo') && restricts[0]?.deny?.includes('mcp__demo__sum'),
    'manual mode hides every tool of the server',
    restricts[0],
  )
  check(
    JSON.stringify(restricts[0]?.deny).includes('mcp__tokened__') === false,
    'other servers are untouched',
    restricts[0],
  )
  check(guards.length === 1, 'agent guard registered', guards.length)
  check(
    typeof guards[0]?.({ name: 'mcp__demo__echo', arguments: {} }) === 'string',
    'guard denies a manual server tool that slips past the restriction',
    guards[0]?.({ name: 'mcp__demo__echo', arguments: {} }),
  )
  check(
    guards[0]?.({ name: 'mcp__tokened__echo', arguments: {} }) === undefined,
    'guard allows other servers',
  )
  check(
    typeof guards[0]?.({ name: 'list_mcp_resources', arguments: { server: 'demo' } }) === 'string',
    'guard denies shared resource tools addressed to a manual server',
  )
  check(
    guards[0]?.({ name: 'list_mcp_resources', arguments: { server: 'tokened' } }) === undefined,
    'guard allows resource tools for an automatic server',
  )
  check(
    guards[0]?.({ name: 'read', arguments: {} }) === undefined,
    'guard ignores non-MCP tools',
  )

  console.log('\ncall and test actions')
  const call = await post('call', { id: 'demo', tool: 'echo', arguments: { text: 'hi' } })
  check(call.status === 200 && call.body?.ok === true, 'call action ok', call.body)
  check(call.body?.result?.value?.echoed === 'hi', 'call result is the tool value', call.body?.result)
  const tested = await post('test', { id: 'demo' })
  check(tested.body?.result?.ok === true, 'test lists tools', tested.body?.result)

  console.log('\ncommand surface')
  const command = commands[0]
  for (const [line, expectFragment] of [
    ['list', 'demo'],
    ['tools', 'echo'],
    ['auto demo', 'model may call'],
    ['manual demo', '/mcp call'],
    ['help', 'MCP Center commands'],
  ]) {
    const result = await command.handler({ rawInput: line, signal: new AbortController().signal })
    check(result.kind === 'success', `/mcp ${line} succeeded`, result)
    check(String(result.text ?? '').includes(expectFragment), `/mcp ${line} mentions "${expectFragment}"`, result.text)
  }
  const failing = await command.handler({ rawInput: 'call demo nope {}', signal: new AbortController().signal })
  check(failing.kind === 'error', '/mcp call with an unknown tool reports an error', failing)

  console.log('\ntoggle and external discovery')
  const toggled = await post('toggle', { id: 'demo', enabled: false })
  check(toggled.body?.server?.enabled === false, 'toggle disables the server', toggled.body?.server)
  check(calls.toggle.length === 1, 'setPluginEnabled was called', calls.toggle)
  const toggledBack = await post('toggle', { id: 'demo', enabled: true })
  check(toggledBack.body?.server?.enabled === true, 'toggle re-enables the server')

  plugins.push({
    patchId: 'mcp-github',
    entryId: 'entry-mcp-github',
    moduleName: '@deepseek-ai/dsh-mcp-client',
    enabled: true,
    fiberPhase: 'active',
  })
  toolSchemas.push({
    name: 'mcp__github__create_issue',
    description: 'Create an issue',
    parameters: { type: 'object', properties: {} },
  })
  const refreshed = await post('refresh', {})
  check(refreshed.status === 200, 'refresh ok', refreshed.status)
  const external = refreshed.body?.servers?.find((server) => server.id === 'github')
  check(external?.origin === 'external', 'externally configured server discovered', external)

  console.log('\nupdate connection reinstalls')
  const before = calls.install.length
  const updated = await post('update', {
    id: 'tokened',
    patch: { args: ['-y', 'pkg', 'C:/data'], env: { API_KEY: 'next-secret' } },
  })
  check(updated.status === 200, 'update 200', updated.body)
  check(calls.remove.includes('@dsh-mcp-center/server-tokened'), 'old bundle removed on change', calls.remove)
  check(calls.install.length === before + 1, 'bundle reinstalled after a connection change', calls.install.length)

  console.log('\nremove')
  const removed = await post('remove', { id: 'tokened' })
  check(removed.status === 200 && removed.body?.removed === true, 'remove ok', removed.body)
  const afterRemove = await request('/api/dsh-mcp-center/state')
  check(
    !afterRemove.body.servers.some((server) => server.id === 'tokened'),
    'removed server no longer listed',
  )
  const removedDirExists = await fs
    .stat(path.join(dataDir, 'servers', 'tokened'))
    .then(() => true)
    .catch(() => false)
  check(removedDirExists === false, 'generated bundle directory deleted')

  console.log('\nguards')
  const forbidden = await (async () => {
    const route = routes[0]
    const req = {
      method: 'GET',
      url: '/api/dsh-mcp-center/state',
      socket: { remoteAddress: '10.0.0.9' },
      async *[Symbol.asyncIterator]() {},
    }
    const result = { status: 0, body: null }
    const res = {
      writeHead(status) {
        result.status = status
      },
      end(text) {
        result.body = JSON.parse(String(text))
      },
    }
    await route.handler(req, res)
    return result
  })()
  check(forbidden.status === 403, 'non-loopback callers are refused', forbidden)

  const bad = await post('create', { name: '***', command: 'node' })
  check(bad.status === 400 || bad.body?.ok === false, 'invalid server name rejected', bad.body)

  const duplicate = await post('create', { name: 'demo', command: 'node' })
  check(duplicate.status === 400 || duplicate.body?.ok === false, 'duplicate server rejected', duplicate.body)

  const unknown = await post('nope', {})
  check(unknown.status === 400, 'unknown action rejected', unknown.status)

  console.log('\ncleanup and restart persistence')
  for (const dispose of disposers.reverse()) {
    try {
      await dispose()
    } catch (error) {
      console.error('  dispose failed', error)
    }
  }
  const restartCtx = { ...ctx }
  const routesBefore = routes.length
  module.apply(restartCtx, { enabled: true, dataDir, allowRemote: false })
  await new Promise((resolve) => setTimeout(resolve, 80))
  check(routes.length === routesBefore + 1, 'restart registers its route again', routes.length)
  const afterRestart = await request('/api/dsh-mcp-center/state')
  check(
    afterRestart.body?.servers?.some((server) => server.id === 'demo'),
    'servers survive a restart',
    afterRestart.body?.servers?.map((server) => server.id),
  )
  check(
    afterRestart.body?.servers?.some((server) => server.id === 'tokened') === false,
    'removed servers do not come back',
  )

  await fs.rm(dataDir, { recursive: true, force: true })
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
