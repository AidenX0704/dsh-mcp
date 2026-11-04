/**
 * `npm test` — the offline suite for dsh-mcp-center.
 *
 * Four independent checks, each a plain `node` process so a failure reports its
 * own exit code and its own output:
 *   1. test/host-harness.mjs  — Host half against a mock Cordis context
 *   2. test/client-smoke.mjs  — Client half rendered with a React stub
 *   3. demo/demo-server.mjs --selftest — the demo MCP server's protocol checks
 *   4. test/mcp-probe.mjs — a real stdio handshake against that demo server
 *
 * Nothing here needs the network, a package download, or a running Harness, so
 * it also runs in CI and from an installed copy. The live end-to-end test
 * (test/e2e-http.mjs) talks to a running Harness instead, so it stays opt-in:
 *   node test/run.mjs --e2e      (or DSH_WEB_URL=... node test/e2e-http.mjs)
 *
 * @module dsh-mcp-center/test/run
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const withE2e = process.argv.includes('--e2e')

/**
 * Run one suite to completion, streaming its output as it arrives.
 * @param {string} label Suite name for the summary.
 * @param {string} script Repo-relative script path.
 * @param {string[]} [args] Extra arguments after the script path.
 * @returns {Promise<boolean>} whether the suite exited 0.
 */
function run(label, script, args = []) {
  const file = path.join(REPO, script)
  console.log(`\n=== ${label} — ${script}`)
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: REPO,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', (error) => {
      console.error(`${label}: failed to start: ${error.message}`)
      resolve(false)
    })
    child.on('exit', (code, signal) => {
      if (signal !== null) {
        console.error(`${label}: killed by ${signal}`)
        resolve(false)
        return
      }
      resolve(code === 0)
    })
  })
}

const suites = [
  ['Host half (mock Cordis)', 'test/host-harness.mjs'],
  ['Client half (React stub)', 'test/client-smoke.mjs'],
  ['Demo MCP server (selftest)', 'demo/demo-server.mjs', ['--selftest']],
  ['MCP stdio probe', 'test/mcp-probe.mjs', ['--', 'node', 'demo/demo-server.mjs']],
]

if (withE2e) suites.push(['Live Harness (HTTP)', 'test/e2e-http.mjs'])

const results = []
for (const [label, script, args] of suites) {
  results.push([label, await run(label, script, args)])
}

console.log('\n=== summary')
let failed = 0
for (const [label, ok] of results) {
  if (!ok) failed += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
}
if (withE2e === false) console.log('\n(live end-to-end suite skipped: run with --e2e)')
console.log(`\n${failed === 0 ? 'ALL SUITES PASSED' : `${failed} SUITE(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
