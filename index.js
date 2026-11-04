/**
 * dsh-mcp-center — Host half.
 *
 * Owns the MCP Center: a small durable registry of MCP server definitions, the
 * generated config-only bundles that connect them through the shipped
 * `@deepseek-ai/dsh-mcp-client` row, the per-Session visibility rules
 * (scope + auto/manual invocation), a loopback-only HTTP API for the Web page,
 * an agent tool (`mcp_manager`), and the `/mcp` command for manual invocation.
 *
 * Design notes
 * - The shipped MCP client is the only component that speaks the protocol; this
 *   plugin never re-implements MCP. Each configured server materializes as its
 *   own tiny bundle (package.json + cordis.patch.yml) under the plugin data
 *   directory and is installed through the profile Plugin Manager, so rows,
 *   enablement, HMR and uninstall all keep working exactly like any other
 *   plugin row.
 * - Nothing here rewrites the profile patch by hand and nothing writes the
 *   profile's package.json; `ctx.pluginManager` owns both.
 * - Scope and invocation mode are enforced with `ctx.tools.restrict()` on each
 *   Agent's own context, so the model's tool list and execution stay aligned.
 *
 * @module dsh-mcp-center
 */

import { promises as fs, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

/** Bundle / row identity. */
const PACKAGE_NAME = 'dsh-mcp-center'
const ROW_PREFIX = 'mcp-center-'
const BUNDLE_PREFIX = '@dsh-mcp-center/server-'
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
/** HTTP surface. */
const ROUTE_BASE = '/api/dsh-mcp-center'
/** Server names must satisfy the MCP client's namespace contract. */
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
/** Marker for "reference the process environment instead of storing a secret". */
const ENV_REF_PREFIX = 'env:'
/** Raw `!!js` expression escape for the YAML emitter. */
const RAW_JS = Symbol('raw-js')

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
/**
 * The version this package reports. It is read from the installed manifest, so
 * bumping `package.json` is the only place a release has to be recorded. A
 * failed read must not take the plugin down, hence the neutral fallback.
 * @returns {string} the manifest version.
 */
function readPluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(path.join(MODULE_DIR, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0-unknown'
  } catch {
    return '0.0.0-unknown'
  }
}
const PLUGIN_VERSION = readPluginVersion()

/** @returns {boolean} whether a value is a plain object. */
const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** @returns {string} the bundle package name for one server id. */
function bundleName(id) {
  return `${BUNDLE_PREFIX}${id}`
}

/** @returns {string} the Loader row id for one server id. */
function rowId(id) {
  return `${ROW_PREFIX}${id}`
}

/** @returns {string} the stable mcp tool-name prefix for one server id. */
function toolPrefix(id) {
  return `mcp__${id}__`
}

/** A YAML `!!js` expression node. */
function rawJs(expression) {
  return { [RAW_JS]: expression }
}

/** @returns {boolean} whether value is a raw-js node. */
const isRawJs = (value) => isPlainObject(value) && typeof value[RAW_JS] === 'string'

/**
 * Emit one YAML scalar.
 * @param {unknown} value - scalar, or a raw-js node.
 * @returns {string} YAML text for that scalar.
 */
function yamlScalar(value) {
  if (isRawJs(value)) return `!!js ${value[RAW_JS]}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'null'
  return JSON.stringify(String(value))
}

/**
 * Serialize a JSON-like value as block YAML (the Loader's patch dialect).
 * @param {unknown} value - value to serialize.
 * @param {number} [indent] - current indentation width.
 * @returns {string} YAML text.
 */
function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value
      .map((item) => {
        if (Array.isArray(item)) return `${pad}-\n${toYaml(item, indent + 2)}`
        if (isPlainObject(item) || isRawJs(item)) {
          const inner = toYaml(item, indent + 2).split('\n')
          const head = `${pad}- ${inner[0].slice(indent + 2)}`
          return inner.length === 1 ? head : `${head}\n${inner.slice(1).join('\n')}`
        }
        return `${pad}- ${yamlScalar(item)}`
      })
      .join('\n')
  }
  if (isPlainObject(value) && !isRawJs(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return `${pad}{}`
    return keys
      .map((key) => {
        const entry = value[key]
        if (Array.isArray(entry)) {
          return entry.length === 0
            ? `${pad}${key}: []`
            : `${pad}${key}:\n${toYaml(entry, indent + 2)}`
        }
        if (isPlainObject(entry) && !isRawJs(entry)) {
          return Object.keys(entry).length === 0
            ? `${pad}${key}: {}`
            : `${pad}${key}:\n${toYaml(entry, indent + 2)}`
        }
        return `${pad}${key}: ${yamlScalar(entry)}`
      })
      .join('\n')
  }
  return `${pad}${yamlScalar(value)}`
}

/**
 * Render a stored env/header map as YAML, keeping `env:NAME` values as live
 * `process.env` references instead of copying a secret into the patch.
 * @param {Record<string, string>} map - stored values.
 * @returns {Record<string, unknown>} YAML-ready map.
 */
function toYamlEnvMap(map) {
  const out = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    if (typeof value !== 'string') continue
    if (value.startsWith(ENV_REF_PREFIX)) {
      const name = value.slice(ENV_REF_PREFIX.length).trim()
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        out[key] = rawJs(`process.env.${name}`)
        continue
      }
    }
    out[key] = value
  }
  return out
}

/** @returns {string} the default plugin data directory. */
function defaultDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'mcp-center')
}

/** @returns {string} a filesystem-safe slug. */
function slugify(input) {
  return String(input ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** @returns {boolean} whether the string is a legal MCP server name. */
function isValidServerName(name) {
  return typeof name === 'string' && SERVER_NAME_RE.test(name)
}

/** @returns {number} current epoch milliseconds. */
const now = () => Date.now()

/**
 * Parse an editor-supplied argument list.
 * @param {unknown} value - array, JSON string, or newline/space separated text.
 * @returns {string[]} argument vector.
 */
function parseArgs(value) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value !== 'string' || value.trim() === '') return []
  const text = value.trim()
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    } catch {
      /* fall through to whitespace split */
    }
  }
  return text.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? []
}

/**
 * Parse an `KEY=value` / JSON env map from an editor field.
 * @param {unknown} value - object or text.
 * @returns {Record<string, string>} env map.
 */
function parseEnvMap(value) {
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') out[key] = entry
      else if (entry === null) out[key] = null
      else if (entry !== undefined) out[key] = String(entry)
    }
    return out
  }
  if (typeof value !== 'string' || value.trim() === '') return {}
  const text = value.trim()
  if (text.startsWith('{')) {
    try {
      return parseEnvMap(JSON.parse(text))
    } catch {
      /* fall through to line parsing */
    }
  }
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/.exec(line)
    if (match) out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

/**
 * Substitute `${KEY}` placeholders in every string of a draft.
 * @param {unknown} value - value to walk.
 * @param {Record<string, string>} fields - key to replacement text.
 * @returns {unknown} substituted copy.
 */
function substitute(value, fields) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, key) =>
      Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : whole,
    )
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, fields))
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, entry] of Object.entries(value)) out[key] = substitute(entry, fields)
    return out
  }
  return value
}

/** @returns {string[]} every `${KEY}` placeholder found in a value. */
function collectPlaceholders(value, out = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) out.add(match[1])
    return [...out]
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPlaceholders(item, out)
    return [...out]
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectPlaceholders(item, out)
  }
  return [...out]
}

/**
 * Mask a stored value for display; the full value never leaves the Host.
 * @param {string} value - stored value (may be an `env:NAME` reference).
 * @returns {{ set: boolean, masked: string, external: boolean }} display shape.
 */
function maskValue(value) {
  if (typeof value !== 'string' || value === '') return { set: false, masked: '', external: false }
  if (value.startsWith(ENV_REF_PREFIX)) {
    return { set: true, masked: value, external: true }
  }
  if (value.length <= 8) return { set: true, masked: '••••', external: false }
  return { set: true, masked: `${value.slice(0, 3)}••••${value.slice(-2)}`, external: false }
}

/**
 * Normalize one loose MCP server description into a draft.
 * Accepts Claude Desktop / Cursor (`mcpServers`), VS Code (`servers`) and the
 * shipped client's own field set.
 * @param {string} id - candidate server name.
 * @param {Record<string, unknown>} input - loose description.
 * @returns {{ draft: Record<string, unknown> | null, errors: string[], warnings: string[] }} result.
 */
function normalizeDraft(id, input) {
  const warnings = []
  const errors = []
  const raw = isPlainObject(input) ? input : {}
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  const url = typeof raw.url === 'string' && raw.url.trim() !== '' ? raw.url.trim() : null
  const command = typeof raw.command === 'string' && raw.command.trim() !== '' ? raw.command.trim() : null
  let transport = typeof raw.transport === 'string' ? raw.transport.toLowerCase() : ''
  if (transport === 'sse') {
    transport = 'streamable-http'
    warnings.push('SSE transport is not supported by the shipped client; using streamable-http.')
  }
  if (transport === 'http' || transport === 'streamable_http') transport = 'streamable-http'
  if (!transport) {
    if (type === 'stdio' || (!url && command)) transport = 'stdio'
    else if (url) transport = 'streamable-http'
    else if (command) transport = 'stdio'
  }

  const cleanId = slugify(raw.serverName ?? raw.name ?? id)
  if (!isValidServerName(cleanId)) {
    errors.push(
      `Invalid server name "${raw.serverName ?? raw.name ?? id}": use 1-32 characters from A-Z a-z 0-9 _ -`,
    )
  }
  if (transport === 'stdio') {
    if (!command) errors.push('stdio servers need a "command"')
  } else if (transport === 'streamable-http') {
    if (!url) errors.push('streamable-http servers need a "url"')
  } else {
    errors.push(`Unsupported transport "${raw.transport ?? type}"; use stdio or streamable-http`)
  }

  const draft = {
    id: cleanId,
    title: typeof raw.title === 'string' && raw.title ? raw.title : cleanId,
    description: typeof raw.description === 'string' ? raw.description : '',
    transport,
    command: transport === 'stdio' ? command : null,
    args: transport === 'stdio' ? parseArgs(raw.args) : [],
    env: transport === 'stdio' ? stripNulls(parseEnvMap(raw.env)) : {},
    cwd: transport === 'stdio' && typeof raw.cwd === 'string' && raw.cwd ? raw.cwd : null,
    url: transport === 'streamable-http' ? url : null,
    headers: transport === 'streamable-http' ? stripNulls(parseEnvMap(raw.headers)) : {},
    toolCallTimeoutMs:
      Number.isFinite(Number(raw.toolCallTimeoutMs)) && Number(raw.toolCallTimeoutMs) > 0
        ? Number(raw.toolCallTimeoutMs)
        : null,
    marketId: typeof raw.marketId === 'string' ? raw.marketId : null,
    mode: raw.mode === 'manual' ? 'manual' : 'auto',
    scope: normalizeScope(raw.scope),
  }
  return { draft: errors.length === 0 ? draft : null, errors, warnings }
}

/** @returns {Record<string, string>} map without null entries. */
function stripNulls(map) {
  const out = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    if (value !== null) out[key] = value
  }
  return out
}

/**
 * Normalize a scope declaration.
 * @param {unknown} value - loose scope.
 * @returns {{ kind: 'all'|'workspace'|'session', workspaceIds: string[], sessionIds: string[] }} scope.
 */
function normalizeScope(value) {
  const raw = isPlainObject(value) ? value : {}
  const kind = raw.kind === 'workspace' || raw.kind === 'session' ? raw.kind : 'all'
  return {
    kind,
    workspaceIds: Array.isArray(raw.workspaceIds)
      ? raw.workspaceIds.filter((item) => typeof item === 'string')
      : [],
    sessionIds: Array.isArray(raw.sessionIds)
      ? raw.sessionIds.filter((item) => typeof item === 'string')
      : [],
  }
}

/**
 * Parse an import document into draft candidates.
 * @param {unknown} document - pasted JSON (object or string).
 * @returns {{ candidates: Array<{ id: string, draft: object|null, errors: string[], warnings: string[] }>, errors: string[] }} parse result.
 */
function parseImportDocument(document) {
  let value = document
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return { candidates: [], errors: ['The pasted JSON is empty'] }
    try {
      value = JSON.parse(text)
    } catch (error) {
      return { candidates: [], errors: [`Invalid JSON: ${error.message}`] }
    }
  }
  if (!isPlainObject(value)) {
    return { candidates: [], errors: ['Paste a JSON object describing one or more MCP servers'] }
  }
  /** @type {Record<string, unknown>} */
  let group = null
  if (isPlainObject(value.mcpServers)) group = value.mcpServers
  else if (isPlainObject(value.servers)) group = value.servers
  if (group) {
    const candidates = []
    for (const [id, entry] of Object.entries(group)) {
      const result = normalizeDraft(id, entry)
      candidates.push({ id, ...result })
    }
    if (candidates.length === 0) return { candidates: [], errors: ['No server entries found'] }
    return { candidates, errors: [] }
  }
  const id = value.serverName ?? value.name ?? value.id
  const result = normalizeDraft(slugify(id ?? 'server'), value)
  return { candidates: [{ id: String(id ?? 'server'), ...result }], errors: [] }
}

/**
 * The MCP Center Host plugin.
 * @param {import('cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} config - row config from the profile patch.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const dataDir =
    typeof config.dataDir === 'string' && config.dataDir
      ? path.resolve(config.dataDir)
      : defaultDataDir()
  const statePath = path.join(dataDir, 'state.json')
  const allowRemote = config.allowRemote === true
  const enabled = config.enabled !== false

  /** @type {{ version: number, servers: Record<string, any>, settings: Record<string, unknown> }} */
  let state = { version: 1, servers: {}, settings: { marketplaceInstalled: {} } }
  let stateRev = 0
  let toolsRev = 0
  /** @type {Map<string, Array<{ name: string, description: string, parameters: unknown }>>} */
  let toolsByServer = new Map()
  /** @type {Map<string, { agent: any, dispose: (() => void) | undefined, toolsRev: number, stateRev: number }>} */
  const liveAgents = new Map()
  /** @type {Map<string, { at: number, value: Record<string, unknown> }>} */
  const environmentCache = new Map()
  let marketplaceCache = null
  let writeChain = Promise.resolve()
  let disposed = false

  /** Serialize state mutations. @param {() => Promise<any>} task - work to run. @returns {Promise<any>} result. */
  function withLock(task) {
    const next = writeChain.then(task, task)
    writeChain = next.catch(() => undefined)
    return next
  }

  /** @returns {string} the local OS label. */
  function platformLabel() {
    if (process.platform === 'win32') return 'windows'
    if (process.platform === 'darwin') return 'macos'
    return 'linux'
  }

  /** @returns {Promise<void>} ensure the data directory exists. */
  async function ensureDataDir() {
    await fs.mkdir(dataDir, { recursive: true })
  }

  /**
   * Atomically persist the state file (mode 0600: it may hold secrets).
   * @returns {Promise<void>} resolution after the rename.
   */
  async function writeState() {
    await ensureDataDir()
    const tmp = `${statePath}.${process.pid}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(tmp, statePath)
    stateRev += 1
  }

  /** @returns {Promise<void>} load the state file, normalizing legacy shapes. */
  async function loadState() {
    try {
      const text = await fs.readFile(statePath, 'utf8')
      const parsed = JSON.parse(text)
      state = {
        version: 1,
        servers: isPlainObject(parsed?.servers) ? parsed.servers : {},
        settings: isPlainObject(parsed?.settings) ? parsed.settings : { marketplaceInstalled: {} },
      }
      for (const [id, server] of Object.entries(state.servers)) {
        if (!isPlainObject(server)) {
          delete state.servers[id]
          continue
        }
        server.id = id
        server.transport = server.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
        server.args = Array.isArray(server.args) ? server.args.map(String) : []
        server.env = isPlainObject(server.env) ? server.env : {}
        server.headers = isPlainObject(server.headers) ? server.headers : {}
        server.mode = server.mode === 'manual' ? 'manual' : 'auto'
        server.scope = normalizeScope(server.scope)
        server.enabled = server.enabled !== false
        server.origin = server.origin === 'external' ? 'external' : 'managed'
        server.status = isPlainObject(server.status) ? server.status : { phase: 'idle', message: '' }
        server.createdAt = Number(server.createdAt) || now()
        server.updatedAt = Number(server.updatedAt) || server.createdAt
      }
      stateRev += 1
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn?.(`[${PACKAGE_NAME}] cannot read state: ${error.message}`)
    }
  }

  /** @returns {Record<string, unknown> | null} the bundled marketplace document. */
  function marketplace() {
    if (marketplaceCache) return marketplaceCache
    try {
      const textPath = path.join(MODULE_DIR, 'data', 'marketplace.json')
      marketplaceCache = JSON.parse(readFileSync(textPath, 'utf8'))
    } catch (error) {
      logger.warn?.(`[${PACKAGE_NAME}] marketplace catalog unavailable: ${error.message}`)
      marketplaceCache = { version: 1, categories: [], servers: [] }
    }
    return marketplaceCache
  }

  /** @returns {Promise<Record<string, unknown>>} probe local runtime prerequisites. */
  async function probeEnvironment() {
    const cached = environmentCache.get('env')
    if (cached && now() - cached.at < 60_000) return cached.value
    /** @param {string} command @param {string[]} args @returns {Promise<string | null>} */
    const run = (command, args) =>
      new Promise((resolve) => {
        const child = execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => {
          if (error) resolve(null)
          else resolve(String(stdout ?? '').trim().split(/\r?\n/)[0] || '')
        })
        child.on('error', () => resolve(null))
      })
    const [node, python, uv, docker] = await Promise.all([
      run(process.execPath, ['--version']),
      run(process.platform === 'win32' ? 'python' : 'python3', ['--version']),
      run('uv', ['--version']),
      run('docker', ['--version']),
    ])
    const workspaces = (() => {
      try {
        const registry = ctx.get('workspaceRegistry', false)
        return (registry?.list?.() ?? []).map((workspace) => ({
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessionIds: Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
        }))
      } catch {
        return []
      }
    })()
    const sessions = (() => {
      try {
        const store = ctx.get('sessions', false)
        return (store?.list?.() ?? []).map((session) => {
          const owner = workspaces.find((workspace) => workspace.sessionIds.includes(session.id))
          return {
            id: session.id,
            cwd: session.header?.cwd ?? null,
            createdAt: session.header?.createdAt ?? null,
            workspaceId: owner?.id ?? null,
          }
        })
      } catch {
        return []
      }
    })()
    const value = {
      platform: platformLabel(),
      node,
      python,
      uv,
      docker,
      hasNode: node !== null,
      hasPython: python !== null,
      hasUv: uv !== null,
      hasDocker: docker !== null,
      /** The shipped MCP client carries header credentials only; it has no OAuth flow. */
      oauthSupport: false,
      workspaces,
      sessions,
      dataDir,
      demoServer: demoServerDescriptor(),
      version: PLUGIN_VERSION,
    }
    environmentCache.set('env', { at: now(), value })
    return value
  }

  /** @returns {{ name: string, command: string, args: string[] } | null} the local demo server descriptor. */
  function demoServerDescriptor() {
    const file = path.join(MODULE_DIR, 'demo', 'demo-server.mjs')
    return { name: 'demo', command: 'node', args: [file] }
  }

  /**
   * The marketplace document plus entries this package can provide locally.
   * The demo server needs no network and no package download, so it is always a
   * working first connection.
   * @returns {Record<string, any>} marketplace payload.
   */
  function marketplacePayload() {
    const document = marketplace()
    const demo = demoServerDescriptor()
    const local = {
      id: 'demo',
      title: { zh: '本地演示服务器', en: 'Local demo server' },
      summary: {
        zh: '无需网络与依赖的内置 MCP 服务器，提供 echo/add/now/list_dir 四个工具和两个资源，用来验证整条链路。',
        en: 'Built-in MCP server with no network or dependencies: tools echo/add/now/list_dir plus two resources, for validating the whole pipeline.',
      },
      category: 'local',
      transport: 'stdio',
      command: demo.command,
      args: demo.args,
      url: null,
      env: {},
      headers: {},
      fields: [],
      requirements: [],
      auth: 'none',
      docs: 'https://modelcontextprotocol.io',
      homepage: 'https://modelcontextprotocol.io',
      tags: ['demo', 'local', 'offline'],
      verifiedAt: '2026-11-04',
      notes: {
        zh: '随插件一起提供，直接从本机 Node 启动，不下载任何包。',
        en: 'Ships with this plugin and starts from the local Node runtime without downloading anything.',
      },
    }
    const categories = Array.isArray(document.categories) ? [...document.categories] : []
    if (!categories.some((category) => category.id === 'local')) {
      categories.unshift({ id: 'local', title: { zh: '本地内置', en: 'Built in' } })
    }
    const servers = Array.isArray(document.servers) ? document.servers : []
    return {
      ...document,
      categories,
      servers: [local, ...servers.filter((entry) => entry?.id !== 'demo')],
    }
  }

  /** @returns {Map<string, Array<{name: string, description: string, parameters: unknown}>>} live MCP tools by server. */
  function scanTools() {
    const map = new Map()
    let schemas = []
    try {
      schemas = ctx.tools.schemas()
    } catch (error) {
      logger.warn?.(`[${PACKAGE_NAME}] tool scan failed: ${error.message}`)
      return map
    }
    for (const schema of schemas) {
      const match = /^mcp__([A-Za-z0-9_-]+)__/.exec(schema.name)
      if (!match) continue
      const list = map.get(match[1]) ?? []
      list.push({ name: schema.name, description: schema.description, parameters: schema.parameters })
      map.set(match[1], list)
    }
    return map
  }

  /** @returns {string} a signature of the current MCP tool set, used to detect changes. */
  function toolSignature(map) {
    const parts = []
    for (const [server, list] of map) parts.push(`${server}:${list.map((tool) => tool.name).sort().join(',')}`)
    return parts.sort().join('|')
  }

  /**
   * Whether a server is visible inside one session.
   * @param {any} server - server record.
   * @param {string} sessionId - the session.
   * @param {string | null} cwd - that session's cwd.
   * @returns {boolean} whether the session is in scope.
   */
  function inScope(server, sessionId, cwd) {
    const scope = normalizeScope(server.scope)
    if (scope.kind === 'all') return true
    if (scope.kind === 'session') return scope.sessionIds.includes(sessionId)
    if (scope.workspaceIds.length === 0) return true
    try {
      const registry = ctx.get('workspaceRegistry', false)
      const owned = (registry?.list?.() ?? []).some(
        (workspace) => scope.workspaceIds.includes(workspace.id) && workspace.sessionIds.includes(sessionId),
      )
      if (owned) return true
      const paths = (registry?.list?.() ?? [])
        .filter((workspace) => scope.workspaceIds.includes(workspace.id))
        .map((workspace) => workspace.path)
        .filter((entry) => typeof entry === 'string')
      if (!cwd) return false
      const normalizedCwd = path.resolve(cwd).toLowerCase()
      return paths.some((base) => {
        const normalizedBase = path.resolve(base).toLowerCase()
        return normalizedCwd === normalizedBase || normalizedCwd.startsWith(`${normalizedBase}${path.sep}`)
      })
    } catch {
      return false
    }
  }

  /**
   * Compute the exact tool names one agent must not see.
   * @param {any} agent - the agent.
   * @returns {string[]} deny list.
   */
  function computeDeny(agent) {
    const deny = []
    let session = null
    try {
      session = ctx.get('sessions', false)?.get?.(agent.id) ?? null
    } catch {
      session = null
    }
    const cwd = session?.header?.cwd ?? null
    for (const server of Object.values(state.servers)) {
      const tools = toolsByServer.get(server.id) ?? []
      if (tools.length === 0) continue
      if (!server.enabled) {
        deny.push(...tools.map((tool) => tool.name))
        continue
      }
      const visible = inScope(server, agent.id, cwd)
      if (!visible || server.mode === 'manual') deny.push(...tools.map((tool) => tool.name))
    }
    return deny
  }

  /**
   * The resource tools the MCP resource service registers globally; they take a
   * server name, so hiding `mcp__<server>__*` alone would leave them reachable.
   */
  const RESOURCE_TOOLS = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])

  /**
   * Whether one server is unavailable to an agent (disabled, out of scope, or
   * command-only).
   * @param {any} server - server record.
   * @param {any} agent - the agent.
   * @returns {boolean} whether the agent must not use it.
   */
  function unavailableFor(server, agent) {
    if (!server || server.enabled === false) return true
    if (server.mode === 'manual') return true
    let cwd = null
    try {
      cwd = ctx.get('sessions', false)?.get?.(agent.id)?.header?.cwd ?? null
    } catch {
      cwd = null
    }
    return !inScope(server, agent.id, cwd)
  }

  /**
   * Guard one tool execution for an agent: deny MCP tools of unavailable
   * servers, including the shared resource tools addressed by server name.
   * @param {any} execution - tool execution.
   * @param {any} agent - the agent.
   * @returns {string | undefined} a denial reason, or undefined to allow.
   */
  function guardExecution(execution, agent) {
    const name = typeof execution?.name === 'string' ? execution.name : ''
    const args = isPlainObject(execution?.arguments) ? execution.arguments : {}
    if (RESOURCE_TOOLS.has(name)) {
      const serverName = typeof args.server === 'string' ? args.server : null
      if (!serverName) return undefined
      const server = state.servers[serverName]
      if (!server) return undefined
      return unavailableFor(server, agent)
        ? `MCP server "${serverName}" is not available in this session (disabled, out of scope, or command-only)`
        : undefined
    }
    const match = /^mcp__([A-Za-z0-9_-]+)__/.exec(name)
    if (!match) return undefined
    const server = state.servers[match[1]]
    if (!server) return undefined
    return unavailableFor(server, agent)
      ? `MCP server "${match[1]}" is not available in this session (disabled, out of scope, or command-only)`
      : undefined
  }

  /**
   * Re-register one agent's tool restriction when its inputs changed.
   * @param {string} agentId - session id of the agent.
   * @returns {void}
   */
  function refreshAgent(agentId) {
    const record = liveAgents.get(agentId)
    if (!record || disposed) return
    if (record.toolsRev === toolsRev && record.stateRev === stateRev) return
    record.toolsRev = toolsRev
    record.stateRev = stateRev
    try {
      record.dispose?.()
    } catch {
      /* the previous scope may already be torn down */
    }
    record.dispose = undefined
    const deny = computeDeny(record.agent)
    try {
      const agentTools = record.agent.ctx?.tools ?? record.agent.ctx?.get?.('tools', false)
      if (!agentTools) return
      record.dispose = record.agent.ctx.effect(() => {
        const owned = []
        if (deny.length > 0 && typeof agentTools.restrict === 'function') {
          owned.push(agentTools.restrict({ deny }))
        }
        if (typeof agentTools.guard === 'function') {
          owned.push(agentTools.guard((execution) => guardExecution(execution, record.agent)))
        }
        return () => {
          for (const dispose of owned.reverse()) {
            try {
              dispose?.()
            } catch {
              /* scope already gone */
            }
          }
        }
      }, `${PACKAGE_NAME}: scope`)
    } catch (error) {
      logger.warn?.(`[${PACKAGE_NAME}] cannot restrict tools for ${agentId}: ${error.message}`)
    }
  }

  /** @returns {void} refresh every live agent. */
  function refreshAllAgents() {
    for (const agentId of liveAgents.keys()) refreshAgent(agentId)
  }

  /**
   * Adopt every live agent the plugin has not seen yet. Activation and HMR can
   * happen after Agents already exist, and `agent/created` only covers Agents
   * created later, so this pass is what keeps an existing Session correctly
   * scoped after an enable/reload.
   * @returns {void}
   */
  function trackLiveAgents() {
    let agents = []
    try {
      agents = ctx.get('agents', false)?.list?.() ?? []
    } catch {
      return
    }
    for (const agent of agents) {
      if (!agent?.id || !agent.ctx || liveAgents.has(agent.id)) continue
      liveAgents.set(agent.id, { agent, dispose: undefined, toolsRev: -1, stateRev: -1 })
      refreshAgent(agent.id)
    }
  }

  /**
   * Rescan the registry and republish derived state when the MCP tool set moved.
   * @param {boolean} [force] - republish even without a signature change.
   * @returns {void}
   */
  function syncTools(force = false) {
    const map = scanTools()
    const signature = toolSignature(map)
    const changed = signature !== (syncTools.signature ?? '')
    toolsByServer = map
    if (changed || force) {
      syncTools.signature = signature
      toolsRev += 1
      for (const server of Object.values(state.servers)) {
        const list = map.get(server.id) ?? []
        server.tools = list.map((tool) => ({
          name: tool.name,
          rawName: tool.name.slice(toolPrefix(server.id).length),
          description: tool.description,
        }))
        server.lastSeenAt = now()
      }
      refreshAllAgents()
    }
  }

  /**
   * Build the MCP client config for one server.
   * @param {any} server - server record.
   * @returns {Record<string, unknown>} client config.
   */
  function clientConfig(server) {
    const configValue = {
      serverName: server.id,
      transport: server.transport,
      failOnStartupError: false,
    }
    if (server.transport === 'stdio') {
      configValue.command = server.command
      if (server.args?.length) configValue.args = [...server.args]
      if (server.cwd) configValue.cwd = server.cwd
      const env = toYamlEnvMap(server.env)
      if (Object.keys(env).length > 0) configValue.env = env
    } else {
      configValue.url = server.url
      const headers = toYamlEnvMap(server.headers)
      if (Object.keys(headers).length > 0) configValue.headers = headers
    }
    if (server.toolCallTimeoutMs) configValue.toolCallTimeoutMs = server.toolCallTimeoutMs
    return configValue
  }

  /**
   * Write the config-only bundle for one server.
   * @param {any} server - server record.
   * @returns {Promise<string>} the bundle directory.
   */
  async function materializeBundle(server) {
    const dir = path.join(dataDir, 'servers', server.id)
    await fs.mkdir(dir, { recursive: true })
    const revision = (server.revision ?? 0) + 1
    server.revision = revision
    const manifest = {
      name: bundleName(server.id),
      version: `0.1.${revision}`,
      private: true,
      type: 'module',
      description: `MCP Center server "${server.id}" (generated; edit it from the MCP Center page)`,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }
    const patch = [
      {
        insert: [
          {
            id: rowId(server.id),
            name: MCP_CLIENT_PACKAGE,
            config: clientConfig(server),
          },
        ],
      },
    ]
    await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.writeFile(path.join(dir, 'cordis.patch.yml'), `${toYaml(patch)}\n`, 'utf8')
    return dir
  }

  /** @returns {Promise<any>} the Plugin Manager service. */
  async function pluginManager() {
    const service = ctx.get('pluginManager', false)
    if (!service) throw new Error('Plugin Manager service is unavailable in this profile')
    return service
  }

  /**
   * Find the live Loader row for one server.
   * @param {string} id - server id.
   * @returns {Promise<any | undefined>} plugin info.
   */
  async function findRow(id) {
    try {
      const manager = await pluginManager()
      const plugins = await manager.listPlugins()
      return plugins.find((plugin) => plugin.patchId === rowId(id))
    } catch {
      return undefined
    }
  }

  /**
   * Ensure the generated bundle is installed and selected.
   * @param {any} server - server record.
   * @param {{ reinstall?: boolean }} [options] - force a remove/reinstall cycle.
   * @returns {Promise<{ status: string, message?: string }>} outcome.
   */
  async function ensureInstalled(server, options = {}) {
    const manager = await pluginManager()
    const dir = await materializeBundle(server)
    const name = bundleName(server.id)
    let bundles = []
    try {
      bundles = await manager.listBundles()
    } catch {
      bundles = []
    }
    const existing = bundles.find((bundle) => bundle.name === name)
    if (existing?.installed && existing.enabled && !options.reinstall) {
      return { status: 'installed' }
    }
    if (existing?.installed && options.reinstall) {
      try {
        await manager.removeBundle(name)
      } catch (error) {
        logger.warn?.(`[${PACKAGE_NAME}] cannot refresh ${name}: ${error.message}`)
      }
    } else if (existing?.installed && !existing.enabled) {
      const change = await manager.setBundleEnabled(name, true)
      if (change?.application === 'failed') {
        return { status: 'error', message: change.error?.diagnostic ?? 'activation failed' }
      }
      return { status: 'enabled' }
    }
    const change = await manager.installBundle(dir, { enabled: true, saveExact: true })
    if (change?.application === 'failed' || change?.application === 'cancelled' || change?.error) {
      return {
        status: 'error',
        message: change?.error?.diagnostic ?? change?.error?.code ?? 'installation failed',
      }
    }
    return { status: 'installed', message: change?.application }
  }

  /**
   * Wait briefly for a freshly installed server to publish tools.
   * @param {string} id - server id.
   * @param {number} [timeoutMs] - inline wait budget.
   * @returns {Promise<boolean>} whether tools appeared.
   */
  async function waitForTools(id, timeoutMs = 8000) {
    const deadline = now() + timeoutMs
    while (now() < deadline && !disposed) {
      if (state.servers[id]?.enabled === false) return false
      syncTools()
      if ((toolsByServer.get(id) ?? []).length > 0) return true
      const row = await findRow(id)
      if (row?.fiberPhase === 'failed') return false
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return (toolsByServer.get(id) ?? []).length > 0
  }

  /**
   * Public view of one server (secrets masked).
   * @param {any} server - server record.
   * @param {Record<string, unknown>} environment - probed environment.
   * @returns {Record<string, unknown>} view.
   */
  function serverView(server, environment) {
    const market = (marketplacePayload().servers ?? []).find((entry) => entry.id === server.marketId)
    const tools = (toolsByServer.get(server.id) ?? []).map((tool) => ({
      name: tool.name,
      rawName: tool.name.slice(toolPrefix(server.id).length),
      description: tool.description,
      parameters: tool.parameters,
    }))
    return {
      id: server.id,
      title: server.title,
      description: server.description,
      origin: server.origin ?? 'managed',
      marketId: server.marketId ?? null,
      marketTitle: market?.title ?? null,
      transport: server.transport,
      command: server.command ?? null,
      args: server.args ?? [],
      cwd: server.cwd ?? null,
      url: server.url ?? null,
      env: Object.entries(server.env ?? {}).map(([key, value]) => ({ key, ...maskValue(value) })),
      headers: Object.entries(server.headers ?? {}).map(([key, value]) => ({ key, ...maskValue(value) })),
      toolCallTimeoutMs: server.toolCallTimeoutMs ?? null,
      enabled: server.enabled !== false,
      mode: server.mode,
      scope: normalizeScope(server.scope),
      status: {
        phase: server.status?.phase ?? 'idle',
        message: server.status?.message ?? '',
        updatedAt: server.status?.updatedAt ?? null,
      },
      tools,
      toolCount: tools.length,
      rowId: rowId(server.id),
      bundleName: bundleName(server.id),
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      reachable: tools.length > 0,
    }
  }

  /** @returns {Promise<Record<string, unknown>>} the full client payload. */
  async function fullState() {
    const environment = await probeEnvironment()
    syncTools()
    const servers = Object.values(state.servers).map((server) => serverView(server, environment))
    return {
      ok: true,
      version: PLUGIN_VERSION,
      localeFree: true,
      servers,
      marketplace: marketplacePayload(),
      environment,
      counts: {
        configured: servers.length,
        enabled: servers.filter((server) => server.enabled).length,
        manual: servers.filter((server) => server.mode === 'manual').length,
        tools: servers.reduce((total, server) => total + server.toolCount, 0),
      },
    }
  }

  /**
   * Create (and connect) one server from a normalized draft.
   * @param {Record<string, unknown>} draft - normalized draft.
   * @returns {Promise<Record<string, unknown>>} server view.
   */
  async function createServer(draft) {
    const id = draft.id
    if (!isValidServerName(id)) throw new Error('Invalid server name')
    if (state.servers[id]) throw new Error(`A server named "${id}" already exists`)
    const timestamp = now()
    const server = {
      id,
      title: draft.title || id,
      description: draft.description ?? '',
      origin: 'managed',
      marketId: draft.marketId ?? null,
      transport: draft.transport,
      command: draft.transport === 'stdio' ? draft.command : null,
      args: draft.transport === 'stdio' ? draft.args ?? [] : [],
      env: draft.transport === 'stdio' ? stripNulls(draft.env ?? {}) : {},
      cwd: draft.transport === 'stdio' ? draft.cwd ?? null : null,
      url: draft.transport === 'streamable-http' ? draft.url : null,
      headers: draft.transport === 'streamable-http' ? stripNulls(draft.headers ?? {}) : {},
      toolCallTimeoutMs: draft.toolCallTimeoutMs ?? null,
      enabled: true,
      mode: draft.mode === 'manual' ? 'manual' : 'auto',
      scope: normalizeScope(draft.scope),
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: { phase: 'installing', message: 'creating bundle', updatedAt: timestamp },
    }
    state.servers[id] = server
    await writeState()
    try {
      const outcome = await ensureInstalled(server)
      if (outcome.status === 'error') {
        server.status = { phase: 'error', message: outcome.message ?? 'installation failed', updatedAt: now() }
      } else {
        server.status = { phase: 'starting', message: 'waiting for tools', updatedAt: now() }
        const ready = await waitForTools(id)
        server.status = ready
          ? { phase: 'ready', message: '', updatedAt: now() }
          : {
              phase: 'pending',
              message: 'Installed, but no tools were discovered yet. Check the command, dependencies or credentials.',
              updatedAt: now(),
            }
      }
    } catch (error) {
      server.status = { phase: 'error', message: error.message, updatedAt: now() }
    }
    await writeState()
    syncTools(true)
    return serverView(server, await probeEnvironment())
  }

  /**
   * Apply a patch to one server, reinstalling when its connection changed.
   * @param {string} id - server id.
   * @param {Record<string, unknown>} patch - editable fields.
   * @returns {Promise<Record<string, unknown>>} server view.
   */
  async function updateServer(id, patch) {
    const server = state.servers[id]
    if (!server) throw new Error(`Unknown server "${id}"`)
    if (server.origin === 'external') {
      const allowed = ['mode', 'scope', 'title', 'description']
      for (const key of Object.keys(patch ?? {})) {
        if (!allowed.includes(key)) {
          throw new Error('Externally configured servers can only change invocation mode, scope and labels')
        }
      }
    }
    let connectionChanged = false
    const before = JSON.stringify(clientConfig(server))
    if (typeof patch.title === 'string' && patch.title.trim() !== '') server.title = patch.title.trim()
    if (typeof patch.description === 'string') server.description = patch.description
    if (patch.mode === 'auto' || patch.mode === 'manual') server.mode = patch.mode
    if (patch.scope !== undefined) server.scope = normalizeScope(patch.scope)
    if (typeof patch.enabled === 'boolean') server.enabled = patch.enabled
    if (server.origin !== 'external') {
      if (patch.transport === 'stdio' || patch.transport === 'streamable-http') server.transport = patch.transport
      if (patch.command !== undefined) server.command = patch.command ? String(patch.command) : null
      if (patch.args !== undefined) server.args = parseArgs(patch.args)
      if (patch.cwd !== undefined) server.cwd = patch.cwd ? String(patch.cwd) : null
      if (patch.url !== undefined) server.url = patch.url ? String(patch.url) : null
      if (patch.env !== undefined) server.env = mergeSecretMap(server.env, asPatchMap(patch.env))
      if (patch.headers !== undefined) {
        server.headers = mergeSecretMap(server.headers, asPatchMap(patch.headers))
      }
      if (patch.toolCallTimeoutMs !== undefined) {
        const value = Number(patch.toolCallTimeoutMs)
        server.toolCallTimeoutMs = Number.isFinite(value) && value > 0 ? value : null
      }
      connectionChanged = JSON.stringify(clientConfig(server)) !== before
    }
    server.updatedAt = now()
    await writeState()
    if (connectionChanged) {
      server.status = { phase: 'updating', message: 'rebuilding connection', updatedAt: now() }
      try {
        const outcome = await ensureInstalled(server, { reinstall: true })
        if (outcome.status === 'error') {
          server.status = { phase: 'error', message: outcome.message ?? 'reinstall failed', updatedAt: now() }
        } else {
          const ready = await waitForTools(id, 6000)
          server.status = ready
            ? { phase: 'ready', message: '', updatedAt: now() }
            : { phase: 'pending', message: 'No tools discovered yet', updatedAt: now() }
        }
      } catch (error) {
        server.status = { phase: 'error', message: error.message, updatedAt: now() }
      }
      await writeState()
    }
    syncTools(true)
    return serverView(server, await probeEnvironment())
  }

  /**
   * Coerce an env/header patch into a key/value map (accepts `KEY=value` text).
   * @param {unknown} value - object or text.
   * @returns {Record<string, string|null>} patch map; null deletes a key.
   */
  function asPatchMap(value) {
    if (isPlainObject(value)) return parseEnvMap(value)
    if (typeof value === 'string') return parseEnvMap(value)
    return {}
  }

  /**
   * Merge an env/header patch: `null` deletes, strings replace, `""` keeps.
   * @param {Record<string, string>} current - current map.
   * @param {unknown} patch - incoming map.
   * @returns {Record<string, string>} merged map.
   */
  function mergeSecretMap(current, patch) {
    const next = { ...(current ?? {}) }
    const incoming = isPlainObject(patch) ? patch : {}
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null) delete next[key]
      else if (typeof value === 'string' && value !== '') next[key] = value
    }
    return next
  }

  /**
   * Remove one server and its generated bundle.
   * @param {string} id - server id.
   * @returns {Promise<{ id: string, removed: boolean }>} outcome.
   */
  async function removeServer(id) {
    const server = state.servers[id]
    if (!server) throw new Error(`Unknown server "${id}"`)
    if (server.origin === 'external') {
      throw new Error('This server is configured outside MCP Center; remove its row from the profile patch instead')
    }
    try {
      const manager = await pluginManager()
      await manager.removeBundle(bundleName(id))
    } catch (error) {
      logger.warn?.(`[${PACKAGE_NAME}] cannot remove bundle for ${id}: ${error.message}`)
    }
    try {
      await fs.rm(path.join(dataDir, 'servers', id), { recursive: true, force: true })
    } catch {
      /* a leftover directory is harmless */
    }
    delete state.servers[id]
    await writeState()
    syncTools(true)
    return { id, removed: true }
  }

  /**
   * Enable or disable one server's row.
   * @param {string} id - server id.
   * @param {boolean} next - desired enablement.
   * @returns {Promise<Record<string, unknown>>} server view.
   */
  async function toggleServer(id, next) {
    const server = state.servers[id]
    if (!server) throw new Error(`Unknown server "${id}"`)
    server.enabled = next !== false
    server.updatedAt = now()
    if (server.origin !== 'external') {
      const manager = await pluginManager()
      const row = await findRow(id)
      if (row?.entryId) {
        try {
          const change = await manager.setPluginEnabled(row.entryId, server.enabled)
          if (change?.application === 'failed') {
            server.status = {
              phase: 'error',
              message: change.error?.diagnostic ?? 'activation failed',
              updatedAt: now(),
            }
          }
        } catch (error) {
          logger.warn?.(`[${PACKAGE_NAME}] cannot toggle ${id}: ${error.message}`)
        }
      }
      if (server.enabled) {
        const bundles = await manager.listBundles().catch(() => [])
        const existing = bundles.find((bundle) => bundle.name === bundleName(id))
        if (!existing?.installed) {
          try {
            const outcome = await ensureInstalled(server)
            if (outcome.status === 'error') {
              server.status = { phase: 'error', message: outcome.message ?? 'install failed', updatedAt: now() }
            }
          } catch (error) {
            server.status = { phase: 'error', message: error.message, updatedAt: now() }
          }
        }
      }
    }
    if (server.enabled && !server.status?.phase) {
      server.status = { phase: 'starting', message: 'waiting for tools', updatedAt: now() }
    }
    await writeState()
    syncTools(true)
    return serverView(server, await probeEnvironment())
  }

  /**
   * Execute one MCP tool through the shared tool pipeline.
   * @param {{ name: string, args: Record<string, unknown> }} request - the call.
   * @param {AbortSignal} [signal] - cancellation.
   * @returns {Promise<Record<string, unknown>>} normalized result.
   */
  async function callTool(request, signal) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const known = typeof ctx.tools.get === 'function' ? ctx.tools.get(request.name) : true
      if (known === undefined || known === null) {
        throw new Error(`Unknown MCP tool "${request.name}". Open the MCP page and refresh the tool list.`)
      }
      const result = await ctx.tools.execute({
        callId: `mcp-center-${randomUUID()}`,
        name: request.name,
        arguments: request.args ?? {},
        signal: controller.signal,
      })
      return {
        isError: result.isError,
        value: result.value ?? null,
        content: result.content ?? [],
        error: result.isError ? result.error?.message ?? 'tool call failed' : null,
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
    }
  }

  /**
   * Resolve `server` or `server.tool` / `server__tool` / full mcp name into a tool.
   * @param {string} id - server id.
   * @param {string} tool - raw or full tool name.
   * @returns {string} the full tool name.
   */
  function resolveToolName(id, tool) {
    if (tool.startsWith('mcp__')) return tool
    const prefix = toolPrefix(id)
    const raw = tool.startsWith(`${id}.`) ? tool.slice(id.length + 1) : tool
    return `${prefix}${raw}`
  }

  /**
   * Test connectivity: list the server's tools and optionally call one.
   * @param {string} id - server id.
   * @param {string} [tool] - raw tool name to call.
   * @param {Record<string, unknown>} [args] - call arguments.
   * @returns {Promise<Record<string, unknown>>} test result.
   */
  async function testServer(id, tool, args) {
    const server = state.servers[id]
    if (!server) throw new Error(`Unknown server "${id}"`)
    syncTools()
    const tools = toolsByServer.get(id) ?? []
    if (!tool) {
      const row = await findRow(id)
      return {
        ok: tools.length > 0,
        tools: tools.map((entry) => ({
          name: entry.name,
          rawName: entry.name.slice(toolPrefix(id).length),
          description: entry.description,
        })),
        row: row ? { enabled: row.enabled, fiberPhase: row.fiberPhase } : null,
        status: server.status,
      }
    }
    const fullName = resolveToolName(id, tool)
    if (!tools.some((entry) => entry.name === fullName)) {
      throw new Error(`Unknown tool "${tool}" on server "${id}"`)
    }
    const result = await callTool({ name: fullName, args: args ?? {} })
    return { ok: !result.isError, tool: fullName, result }
  }

  /**
   * Reconcile the registry with the profile: reinstall missing rows and refresh
   * tool-derived state. Runs in the background at activation.
   * @returns {Promise<void>} resolution when reconciliation finished.
   */
  async function reconcile() {
    syncTools(true)
    for (const server of Object.values(state.servers)) {
      if (disposed) return
      if (server.origin === 'external' || !server.enabled) continue
      try {
        const row = await findRow(server.id)
        if (!row) {
          const bundles = await (await pluginManager()).listBundles().catch(() => [])
          const existing = bundles.find((bundle) => bundle.name === bundleName(server.id))
          if (!existing?.installed) {
            const outcome = await ensureInstalled(server)
            if (outcome.status === 'error') {
              server.status = { phase: 'error', message: outcome.message ?? 'install failed', updatedAt: now() }
            }
          }
        } else if (row.enabled === false) {
          await (await pluginManager()).setPluginEnabled(row.entryId, true)
        }
      } catch (error) {
        logger.warn?.(`[${PACKAGE_NAME}] reconcile ${server.id}: ${error.message}`)
      }
    }
    await writeState().catch(() => undefined)
    syncTools(true)
  }

  /**
   * Discover MCP namespaces that are configured outside MCP Center and expose
   * them read-only so scope/mode stay manageable from one place.
   * @returns {Promise<void>} resolution after the discovery pass.
   */
  async function discoverExternal() {
    let plugins = []
    try {
      plugins = await (await pluginManager()).listPlugins()
    } catch {
      return
    }
    const externalRows = plugins.filter(
      (plugin) =>
        plugin.moduleName === MCP_CLIENT_PACKAGE && !String(plugin.patchId ?? '').startsWith(ROW_PREFIX),
    )
    if (externalRows.length === 0) return
    syncTools()
    let changed = false
    for (const serverId of toolsByServer.keys()) {
      if (state.servers[serverId]) continue
      const ownsRow = externalRows.some((row) => String(row.patchId ?? '').includes(serverId))
      if (!ownsRow) continue
      state.servers[serverId] = {
        id: serverId,
        title: serverId,
        description: '',
        origin: 'external',
        marketId: null,
        transport: 'streamable-http',
        command: null,
        args: [],
        env: {},
        cwd: null,
        url: null,
        headers: {},
        toolCallTimeoutMs: null,
        enabled: true,
        mode: 'auto',
        scope: normalizeScope(null),
        revision: 0,
        createdAt: now(),
        updatedAt: now(),
        status: { phase: 'ready', message: '', updatedAt: now() },
      }
      changed = true
    }
    if (changed) await writeState()
  }

  /** @returns {Promise<Record<string, unknown>>} environment payload. */
  async function environmentPayload() {
    const environment = await probeEnvironment()
    const marketplaceDoc = marketplacePayload()
    return {
      ...environment,
      marketplace: {
        version: marketplaceDoc.version ?? 1,
        generatedAt: marketplaceDoc.generatedAt ?? null,
        categories: marketplaceDoc.categories ?? [],
        count: (marketplaceDoc.servers ?? []).length,
      },
    }
  }

  /**
   * Run one UI action.
   * @param {string} action - action name.
   * @param {Record<string, any>} payload - action payload.
   * @returns {Promise<unknown>} action result.
   */
  async function runAction(action, payload) {
    switch (action) {
      case 'state':
        return fullState()
      case 'environment':
        return environmentPayload()
      case 'preview':
        return parseImportDocument(payload.json)
      case 'create': {
        const imported = payload.json !== undefined ? parseImportDocument(payload.json) : null
        if (imported) {
          const errors = [
            ...imported.errors,
            ...imported.candidates.flatMap((candidate) => candidate.errors),
          ]
          if (errors.length > 0) return { ok: false, errors, candidates: imported.candidates }
          const created = []
          for (const candidate of imported.candidates) {
            const fields = isPlainObject(payload.fields) ? payload.fields : {}
            const draft = substitute(candidate.draft, fields)
            created.push(await createServer({ ...draft, mode: payload.mode ?? draft.mode, scope: payload.scope ?? draft.scope }))
          }
          return { ok: true, servers: created }
        }
        const result = normalizeDraft(
          slugify(payload.name ?? payload.id ?? ''),
          { ...payload, serverName: payload.name ?? payload.id },
        )
        const errors = [...result.errors]
        if (errors.length > 0) return { ok: false, errors }
        const draft = substitute(result.draft, isPlainObject(payload.fields) ? payload.fields : {})
        const server = await createServer(draft)
        return { ok: true, server }
      }
      case 'update':
        return { ok: true, server: await updateServer(payload.id, payload.patch ?? {}) }
      case 'remove':
        return { ok: true, ...(await removeServer(payload.id)) }
      case 'toggle':
        return { ok: true, server: await toggleServer(payload.id, payload.enabled !== false) }
      case 'test':
        return { ok: true, result: await testServer(payload.id, payload.tool, payload.arguments) }
      case 'call':
        return {
          ok: true,
          result: await callTool(
            { name: resolveToolName(payload.id, payload.tool), args: payload.arguments ?? {} },
            undefined,
          ),
        }
      case 'reconcile':
        await reconcile()
        return { ok: true }
      case 'refresh':
        await discoverExternal()
        syncTools(true)
        return fullState()
      default:
        throw new Error(`Unknown action "${action}"`)
    }
  }

  /**
   * Compose a short human summary line for one server, used by the command and tool.
   * @param {any} server - server record.
   * @returns {string} summary line.
   */
  function summaryLine(server) {
    const scope = normalizeScope(server.scope)
    const scopeText =
      scope.kind === 'all'
        ? 'all sessions'
        : scope.kind === 'workspace'
          ? `${scope.workspaceIds.length} workspace(s)`
          : `${scope.sessionIds.length} session(s)`
    const tools = (toolsByServer.get(server.id) ?? []).length
    return `${server.enabled ? '●' : '○'} ${server.id} [${server.transport}] mode=${server.mode} scope=${scopeText} tools=${tools}${server.status?.phase === 'error' ? ` error=${server.status.message}` : ''}`
  }

  /**
   * Run the `/mcp` command.
   * @param {{ rawInput: string, signal: AbortSignal }} invocation - command invocation.
   * @returns {Promise<{ kind: 'success'|'error', text: string }>} command result.
   */
  async function runCommand(invocation) {
    const line = String(invocation.rawInput ?? '').trim()
    const [subcommand, ...rest] = line.split(/\s+/).filter(Boolean)
    const servers = Object.values(state.servers)
    try {
      switch ((subcommand ?? 'help').toLowerCase()) {
        case 'list': {
          syncTools()
          if (servers.length === 0) return { kind: 'success', text: 'No MCP servers configured yet. Open the MCP page in the sidebar to add one.' }
          return {
            kind: 'success',
            text: [
              'MCP servers:',
              ...servers.map((server) => summaryLine(server)),
            ].join('\n'),
          }
        }
        case 'tools': {
          syncTools()
          const id = rest[0]
          if (!id) {
            const discovered = [...toolsByServer.entries()]
            if (discovered.length === 0) {
              return { kind: 'success', text: 'No MCP tools are currently registered.' }
            }
            return {
              kind: 'success',
              text: discovered
                .map(
                  ([server, list]) =>
                    `${server}: ${list.map((tool) => tool.name.slice(toolPrefix(server).length)).join(', ')}`,
                )
                .join('\n'),
            }
          }
          const list = toolsByServer.get(id) ?? []
          if (list.length === 0) return { kind: 'error', text: `No tools discovered for "${id}"` }
          return {
            kind: 'success',
            text: list
              .map((tool) => `${tool.name} — ${tool.description ?? ''}`.trim())
              .join('\n'),
          }
        }
        case 'call': {
          const [id, tool, ...jsonParts] = rest
          if (!id || !tool) return { kind: 'error', text: 'Usage: /mcp call <server> <tool> [json-arguments]' }
          let args = {}
          const jsonText = jsonParts.join(' ')
          if (jsonText) {
            try {
              args = JSON.parse(jsonText)
            } catch (error) {
              return { kind: 'error', text: `Arguments are not valid JSON: ${error.message}` }
            }
          }
          const result = await callTool({ name: resolveToolName(id, tool), args }, invocation.signal)
          const text = result.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
          return {
            kind: result.isError ? 'error' : 'success',
            text: result.isError ? `MCP call failed: ${result.error}` : text || JSON.stringify(result.value, null, 2),
          }
        }
        case 'add': {
          const [name, ...jsonParts] = rest
          if (!name) return { kind: 'error', text: 'Usage: /mcp add <name> <json-config>' }
          let parsed = {}
          const jsonText = jsonParts.join(' ')
          if (jsonText) {
            try {
              parsed = JSON.parse(jsonText)
            } catch (error) {
              return { kind: 'error', text: `Config is not valid JSON: ${error.message}` }
            }
          }
          const result = normalizeDraft(slugify(name), { ...parsed, serverName: name })
          if (result.errors.length > 0) return { kind: 'error', text: result.errors.join('\n') }
          await createServer(result.draft)
          return { kind: 'success', text: `Added ${name}. ${summaryLine(state.servers[result.draft.id])}` }
        }
        case 'rm':
        case 'remove': {
          const id = rest[0]
          if (!id) return { kind: 'error', text: 'Usage: /mcp rm <server>' }
          await removeServer(id)
          return { kind: 'success', text: `Removed ${id}` }
        }
        case 'enable':
        case 'disable': {
          const id = rest[0]
          if (!id) return { kind: 'error', text: `Usage: /mcp ${subcommand} <server>` }
          await toggleServer(id, subcommand === 'enable')
          return { kind: 'success', text: `${summaryLine(state.servers[id])}` }
        }
        case 'auto':
        case 'manual': {
          const id = rest[0]
          if (!id) return { kind: 'error', text: `Usage: /mcp ${subcommand} <server>` }
          await updateServer(id, { mode: subcommand === 'auto' ? 'auto' : 'manual' })
          return {
            kind: 'success',
            text:
              subcommand === 'auto'
                ? `${id}: the model may call this server's tools automatically`
                : `${id}: tools are hidden from the model; use /mcp call ${id} <tool> [json]`,
          }
        }
        case 'scope': {
          const [id, kind, ...values] = rest
          if (!id || !kind) return { kind: 'error', text: 'Usage: /mcp scope <server> <all|workspace|session> [ids...]' }
          const scope =
            kind === 'workspace'
              ? { kind: 'workspace', workspaceIds: values, sessionIds: [] }
              : kind === 'session'
                ? { kind: 'session', workspaceIds: [], sessionIds: values }
                : { kind: 'all', workspaceIds: [], sessionIds: [] }
          await updateServer(id, { scope })
          return { kind: 'success', text: `${summaryLine(state.servers[id])}` }
        }
        case 'test': {
          const [id, tool, ...jsonParts] = rest
          if (!id) return { kind: 'error', text: 'Usage: /mcp test <server> [tool] [json]' }
          const args = jsonParts.length > 0 ? JSON.parse(jsonParts.join(' ')) : {}
          const result = await testServer(id, tool, args)
          return { kind: 'success', text: JSON.stringify(result, null, 2) }
        }
        case 'market': {
          const query = rest.join(' ').toLowerCase()
          const entries = (marketplacePayload().servers ?? []).filter(
            (entry) =>
              !query ||
              entry.id.includes(query) ||
              JSON.stringify(entry.title ?? '').toLowerCase().includes(query) ||
              JSON.stringify(entry.summary ?? '').toLowerCase().includes(query),
          )
          return {
            kind: 'success',
            text: entries
              .map(
                (entry) =>
                  `${entry.id} — ${entry.title?.en ?? ''} (${entry.transport}${entry.auth === 'api-key' ? ', needs API key' : ''})`,
              )
              .join('\n'),
          }
        }
        default:
          return {
            kind: 'success',
            text: [
              'MCP Center commands:',
              '/mcp list — configured servers',
              '/mcp tools [server] — discovered tools',
              '/mcp call <server> <tool> [json] — run a tool manually',
              '/mcp add <name> <json> — add a server',
              '/mcp rm <server> — remove a server',
              '/mcp enable|disable <server> — toggle a server',
              '/mcp auto|manual <server> — invocation mode',
              '/mcp test <server> [tool] [json] — list a server\'s tools, or call one',
              '/mcp scope <server> <all|workspace|session> [ids...]',
              '/mcp market [query] — browse the bundled marketplace',
            ].join('\n'),
          }
      }
    } catch (error) {
      return { kind: 'error', text: error.message }
    }
  }

  /**
   * JSON value returned by the `mcp_manager` tool.
   * @param {Record<string, any>} args - tool arguments.
   * @param {{ signal: AbortSignal }} exec - tool execution context.
   * @returns {Promise<Record<string, unknown>>} tool value.
   */
  async function runManagerTool(args, exec) {
    const action = typeof args.action === 'string' ? args.action : 'list'
    switch (action) {
      case 'list': {
        syncTools()
        return {
          servers: Object.values(state.servers).map((server) => ({
            id: server.id,
            title: server.title,
            transport: server.transport,
            enabled: server.enabled,
            mode: server.mode,
            scope: normalizeScope(server.scope),
            toolCount: (toolsByServer.get(server.id) ?? []).length,
            status: server.status?.phase ?? 'idle',
          })),
        }
      }
      case 'market': {
        const query = String(args.query ?? '').toLowerCase()
        return {
          entries: (marketplacePayload().servers ?? [])
            .filter((entry) => !query || JSON.stringify(entry).toLowerCase().includes(query))
            .map((entry) => ({
              id: entry.id,
              title: entry.title,
              transport: entry.transport,
              auth: entry.auth,
              requirements: entry.requirements ?? [],
              fields: entry.fields ?? [],
            })),
        }
      }
      case 'add': {
        const result = parseImportDocument(args.config ?? args.json ?? args)
        const errors = [...result.errors, ...result.candidates.flatMap((candidate) => candidate.errors)]
        if (errors.length > 0) return { ok: false, errors }
        const created = []
        for (const candidate of result.candidates) {
          created.push(await createServer(candidate.draft))
        }
        return { ok: true, servers: created.map((server) => server.id) }
      }
      case 'update':
        return { ok: true, server: await updateServer(String(args.id), args.patch ?? {}) }
      case 'remove':
        return { ok: true, ...(await removeServer(String(args.id))) }
      case 'toggle':
        return { ok: true, server: await toggleServer(String(args.id), args.enabled !== false) }
      case 'test':
        return { ok: true, result: await testServer(String(args.id), args.tool, args.arguments) }
      case 'call':
        return {
          ok: true,
          result: await callTool(
            { name: resolveToolName(String(args.id), String(args.tool)), args: args.arguments ?? {} },
            exec?.signal,
          ),
        }
      case 'tools': {
        syncTools()
        return {
          tools: Object.fromEntries(
            [...toolsByServer.entries()].map(([server, list]) => [server, list.map((tool) => tool.name)]),
          ),
        }
      }
      default:
        return { ok: false, error: `Unknown action "${action}"` }
    }
  }

  /**
   * Write a JSON response.
   * @param {import('node:http').ServerResponse} res - response.
   * @param {number} status - HTTP status.
   * @param {unknown} value - JSON body.
   * @returns {void}
   */
  function sendJson(res, status, value) {
    const body = JSON.stringify(value)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  /** @returns {boolean} whether the request arrived over loopback. */
  function isLoopback(request) {
    const address = request.socket?.remoteAddress ?? ''
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  /**
   * Authorize one API request.
   * @param {import('node:http').IncomingMessage} request - request.
   * @returns {boolean} whether it may proceed.
   */
  function isAllowed(request) {
    if (isLoopback(request)) return true
    if (!allowRemote) return false
    try {
      const pairing = ctx.get('remoteWebUiPairing', false)
      return pairing?.isPairedDevice?.(request) === true
    } catch {
      return false
    }
  }

  /**
   * Read and parse a bounded JSON request body.
   * @param {import('node:http').IncomingMessage} request - request.
   * @param {number} [limit] - maximum bytes.
   * @returns {Promise<any>} parsed body.
   */
  async function readBody(request, limit = 2 * 1024 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > limit) throw new Error('Request body is too large')
      chunks.push(chunk)
    }
    if (chunks.length === 0) return {}
    const text = Buffer.concat(chunks).toString('utf8')
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(`Invalid JSON body: ${error.message}`)
    }
  }

  /**
   * One transport-agnostic entry point shared by HTTP and the tool.
   * @param {string} action - action name.
   * @param {Record<string, any>} payload - payload.
   * @returns {Promise<unknown>} result.
   */
  async function dispatch(action, payload) {
    try {
      const value = await runAction(action, payload ?? {})
      return { status: 200, body: value }
    } catch (error) {
      logger.warn?.(`[${PACKAGE_NAME}] ${action}: ${error.stack ?? error.message}`)
      return { status: 400, body: { ok: false, error: error.message } }
    }
  }

  /**
   * Answer one MCP Center HTTP request.
   * @param {import('node:http').IncomingMessage} request - request.
   * @param {import('node:http').ServerResponse} response - response.
   * @returns {Promise<void>} resolution after the response is written.
   */
  async function handleRequest(request, response) {
    if (!isAllowed(request)) {
      sendJson(response, 403, { ok: false, error: 'forbidden' })
      return
    }
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const tail = url.pathname.slice(ROUTE_BASE.length).replace(/^\/+/, '')
      if (request.method === 'GET' && (tail === '' || tail === 'state')) {
        sendJson(response, 200, await fullState())
        return
      }
      if (request.method === 'GET' && tail === 'health') {
        sendJson(response, 200, { ok: true, version: PLUGIN_VERSION })
        return
      }
      if (request.method === 'GET' && tail === 'environment') {
        sendJson(response, 200, { ok: true, ...(await environmentPayload()) })
        return
      }
      if (request.method === 'POST' && (tail === 'action' || tail === '')) {
        const body = await readBody(request)
        const action = typeof body.action === 'string' ? body.action : 'state'
        const { status, body: payload } = await dispatch(action, body)
        sendJson(response, status, payload)
        return
      }
      sendJson(response, 404, { ok: false, error: `Unknown route ${url.pathname}` })
    } catch (error) {
      logger.warn?.(`[${PACKAGE_NAME}] route failure: ${error.message}`)
      sendJson(response, 500, { ok: false, error: error.message })
    }
  }

  if (!enabled) return

  ctx.effect(() => {
    disposed = false
    return () => {
      disposed = true
      for (const record of liveAgents.values()) {
        try {
          record.dispose?.()
        } catch {
          /* scope already gone */
        }
      }
      liveAgents.clear()
    }
  }, `${PACKAGE_NAME}: lifecycle`)

  ctx.effect(
    () =>
      ctx.on('agent/created', ({ agent }) => {
        if (!agent?.ctx) return
        if (liveAgents.has(agent.id)) return
        liveAgents.set(agent.id, { agent, dispose: undefined, toolsRev: -1, stateRev: -1 })
        refreshAgent(agent.id)
      }),
    `${PACKAGE_NAME}: agent hooks`,
  )

  ctx.effect(
    () =>
      ctx.on('agent/disposed', ({ agent }) => {
        const record = liveAgents.get(agent.id)
        if (!record) return
        try {
          record.dispose?.()
        } catch {
          /* scope already gone */
        }
        liveAgents.delete(agent.id)
      }),
    `${PACKAGE_NAME}: agent disposal`,
  )

  ctx.effect(() => {
    const handle = setInterval(() => {
      if (disposed) return
      syncTools()
      trackLiveAgents()
      refreshAllAgents()
    }, 4000)
    if (typeof handle?.unref === 'function') handle.unref()
    return () => clearInterval(handle)
  }, `${PACKAGE_NAME}: tool poller`)

  ctx.effect(
    () =>
      ctx.inject(['webServer'], (scoped) => {
        const webServer = scoped?.webServer ?? ctx.get('webServer', false)
        if (!webServer?.register) {
          logger.warn?.(`[${PACKAGE_NAME}] webServer unavailable; the MCP page will not load`)
          return
        }
        const off = webServer.register({
          kind: 'prefix',
          path: ROUTE_BASE,
          handler: handleRequest,
        })
        return () => off?.()
      }),
    `${PACKAGE_NAME}: routes`,
  )

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'mcp',
        description: 'Manage MCP servers: list, tools, call, add, rm, enable/disable, auto/manual, scope, market',
        input: { hint: 'list | tools [server] | call <server> <tool> [json] | add <name> <json> | rm <server>' },
        handler: runCommand,
      }),
    `${PACKAGE_NAME}: /mcp command`,
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'mcp_manager',
        description:
          'Inspect and manage the MCP servers configured in this Harness profile (the MCP Center). Use it to list configured servers and their tools, browse the bundled marketplace, add a server from a connection config, change invocation mode or scope, toggle, test, and call MCP tools. Actions: list, tools, market, add, update, remove, toggle, test, call.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'tools', 'market', 'add', 'update', 'remove', 'toggle', 'test', 'call'],
              description: 'Operation to perform.',
            },
            id: { type: 'string', description: 'Target server id.' },
            config: {
              type: 'object',
              additionalProperties: true,
              description:
                'For add: one server or an import document. Accepts {command,args,env} (stdio), {url,headers} (http), or {mcpServers:{name:{...}}} / {servers:{name:{...}}} groups.',
            },
            patch: {
              type: 'object',
              additionalProperties: true,
              description: 'For update: {title,description,transport,command,args,env,cwd,url,headers,mode,scope,enabled}.',
            },
            enabled: { type: 'boolean', description: 'For toggle: desired enablement.' },
            tool: { type: 'string', description: 'For test/call: raw tool name (or a full mcp__server__tool name).' },
            arguments: {
              type: 'object',
              additionalProperties: true,
              description: 'For test/call: JSON arguments of the MCP tool.',
            },
            query: { type: 'string', description: 'For market: free-text filter.' },
          },
          required: ['action'],
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [
            { type: 'text', text: JSON.stringify(value, null, 2) },
          ],
        },
        isConcurrencySafe: () => false,
        execute: runManagerTool,
      }),
    `${PACKAGE_NAME}: mcp_manager tool`,
  )

  void (async () => {
    await loadState()
    await discoverExternal().catch((error) =>
      logger.warn?.(`[${PACKAGE_NAME}] external discovery failed: ${error.message}`),
    )
    syncTools(true)
    trackLiveAgents()
    await reconcile().catch((error) =>
      logger.warn?.(`[${PACKAGE_NAME}] reconcile failed: ${error.message}`),
    )
    logger.info?.(`[${PACKAGE_NAME}] ready: ${Object.keys(state.servers).length} MCP server(s)`)
  })().catch((error) => {
    logger.warn?.(`[${PACKAGE_NAME}] startup failed: ${error.message}`)
  })
}

export const inject = ['tools', 'commands']
