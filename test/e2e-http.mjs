/**
 * End-to-end test of the running dsh-mcp-center Host half over its real HTTP API.
 *
 * Requires a running Harness Web GUI with this plugin installed and active.
 * Run: DSH_WEB_URL=http://127.0.0.1:6922 node test/e2e-http.mjs
 * (manual test: it creates then removes a demo server in the live profile)
 */

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:3637'
const API = `${BASE}/api/dsh-mcp-center`
let failures = 0
/** @param {boolean} ok @param {string} label @param {unknown} [detail] */
function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500))
}

/** @param {string} path @param {{method?: string, body?: unknown}} [options] */
async function request(path, options = {}) {
  const response = await fetch(API + path, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

/** @param {string} action @param {Record<string, unknown>} [payload] */
const act = (action, payload = {}) => request('/action', { method: 'POST', body: { action, ...payload } })

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @param {(state: any) => boolean} predicate @param {number} [timeoutMs] */
async function waitFor(predicate, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const state = await request('/state')
    last = state.body
    if (state.status === 200 && predicate(state.body)) return state.body
    await sleep(700)
  }
  return last
}

async function main() {
  console.log(`\nbase ${BASE}`)

  console.log('\nhealth and empty state')
  const health = await request('/health')
  check(health.status === 200 && health.body?.ok === true, 'health endpoint answers', health)
  const initial = await request('/state')
  check(initial.status === 200, 'state endpoint answers', initial.status)
  check(Array.isArray(initial.body?.servers) && initial.body.servers.length === 0, 'no servers configured yet')
  const market = initial.body?.marketplace?.servers ?? []
  check(market.length >= 20, 'marketplace ships the bundled catalog plus the demo entry', market.length)
  check(market[0]?.id === 'demo', 'local demo entry is first', market[0]?.id)
  check(
    (initial.body?.marketplace?.categories ?? []).some((category) => category.id === 'local'),
    'local category present',
  )
  check(initial.body?.environment?.oauthSupport === false, 'environment reports no OAuth support')
  check(typeof initial.body?.environment?.node === 'string', 'environment probes node', initial.body?.environment?.node)

  console.log('\nimport preview')
  const preview = await act('preview', {
    json: JSON.stringify({
      mcpServers: {
        'Demo Server': { command: 'node', args: ['demo.mjs'] },
        Remote: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } },
      },
    }),
  })
  check(preview.status === 200, 'preview answers', preview.status)
  check(preview.body?.candidates?.length === 2, 'two candidates parsed', preview.body?.candidates?.length)
  check(preview.body?.candidates?.[0]?.draft?.id === 'Demo-Server', 'names are normalized to a legal server name', preview.body?.candidates?.[0]?.draft?.id)
  check(preview.body?.candidates?.[1]?.draft?.transport === 'streamable-http', 'url entries become streamable-http')

  console.log('\ncreate the built-in demo server from the marketplace entry')
  const demoEntry = market.find((entry) => entry.id === 'demo')
  const started = Date.now()
  const created = await act('create', {
    json: {
      serverName: demoEntry.id,
      title: demoEntry.title?.zh,
      transport: demoEntry.transport,
      command: demoEntry.command,
      args: demoEntry.args,
      marketId: demoEntry.id,
    },
    mode: 'auto',
  })
  const createMs = Date.now() - started
  check(created.status === 200 && created.body?.ok === true, 'create succeeded', created.body)
  console.log(`       create took ${createMs} ms`)
  check(created.body?.servers?.[0]?.id === 'demo', 'created server id is demo', created.body?.servers?.[0]?.id)

  const ready = await waitFor((state) => state.servers?.some((server) => server.id === 'demo' && server.toolCount >= 4), 150000)
  const demo = ready?.servers?.find((server) => server.id === 'demo')
  check(demo?.toolCount >= 4, 'the MCP client discovered 4 tools', demo?.tools?.map((tool) => tool.rawName))
  check(demo?.status?.phase === 'ready', 'server status is ready', demo?.status)
  check(
    demo?.tools?.some((tool) => tool.name === 'mcp__demo__echo' && tool.rawName === 'echo'),
    'tool names use the mcp__<server>__<tool> namespace',
    demo?.tools?.map((tool) => tool.name),
  )
  check(demo?.rowId === 'mcp-center-demo', 'row id is stable', demo?.rowId)

  console.log('\ncall a tool through the manual console path')
  const called = await act('call', { id: 'demo', tool: 'echo', arguments: { text: 'hello-mcp' } })
  check(called.status === 200 && called.body?.ok === true, 'call answered', called.body)
  const text = (called.body?.result?.content ?? []).map((block) => block.text).join(' ')
  check(text.includes('hello-mcp'), 'tool result carries the argument', called.body?.result)

  const added = await act('call', { id: 'demo', tool: 'add', arguments: { a: 2, b: 3 } })
  const addedText = (added.body?.result?.content ?? []).map((block) => block.text).join(' ')
  check(addedText.includes('5'), 'second tool works too', addedText)

  const unknown = await act('call', { id: 'demo', tool: 'nope', arguments: {} })
  check(unknown.status === 400 || unknown.body?.ok === false, 'unknown tool is rejected', unknown.body)

  console.log('\ninvocation mode and scope persist')
  const manual = await act('update', { id: 'demo', patch: { mode: 'manual' } })
  check(manual.body?.server?.mode === 'manual', 'manual mode persisted', manual.body?.server?.mode)
  const scoped = await act('update', {
    id: 'demo',
    patch: { scope: { kind: 'workspace', workspaceIds: [], sessionIds: [] } },
  })
  check(scoped.body?.server?.scope?.kind === 'workspace', 'workspace scope persisted', scoped.body?.server?.scope)
  const back = await act('update', {
    id: 'demo',
    patch: { mode: 'auto', scope: { kind: 'all', workspaceIds: [], sessionIds: [] } },
  })
  check(back.body?.server?.mode === 'auto', 'auto mode restored')

  console.log('\ndisable and enable')
  const disabled = await act('toggle', { id: 'demo', enabled: false })
  check(disabled.body?.server?.enabled === false, 'disable persisted', disabled.body?.server?.enabled)
  const disabledState = await waitFor((state) => {
    const server = state.servers?.find((entry) => entry.id === 'demo')
    return server?.enabled === false && server?.toolCount === 0
  }, 30000)
  const disabledServer = disabledState?.servers?.find((server) => server.id === 'demo')
  check(disabledServer?.toolCount === 0, 'tools disappear while disabled', disabledServer?.toolCount)
  const enabled = await act('toggle', { id: 'demo', enabled: true })
  check(enabled.body?.server?.enabled === true, 'enable persisted')
  const reEnabled = await waitFor((state) => {
    const server = state.servers?.find((entry) => entry.id === 'demo')
    return server?.enabled === true && server?.toolCount >= 4
  }, 90000)
  check(
    (reEnabled?.servers?.find((server) => server.id === 'demo')?.toolCount ?? 0) >= 4,
    'tools come back after re-enabling',
  )

  console.log('\nremove')
  const removed = await act('remove', { id: 'demo' })
  check(removed.status === 200 && removed.body?.removed === true, 'remove answered', removed.body)
  const afterRemove = await request('/state')
  check((afterRemove.body?.servers ?? []).length === 0, 'server list is empty again')
  check(JSON.stringify(afterRemove.body).includes('mcp-center-demo') === false, 'row id no longer exposed')

  console.log('\nguards')
  const badName = await act('create', { name: '***', command: 'node' })
  check(badName.status === 400 || badName.body?.ok === false, 'invalid server name rejected', badName.body)
  const badAction = await act('does-not-exist', {})
  check(badAction.status === 400, 'unknown action rejected', badAction.status)
  const badJson = await request('/action', { method: 'POST', body: { action: 'preview', json: '{oops' } })
  check(badJson.body?.errors?.length > 0, 'broken JSON is reported, not thrown', badJson.body)

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
