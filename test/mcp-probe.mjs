#!/usr/bin/env node
/**
 * mcp-probe — a tiny, dependency-free MCP stdio client used to smoke-test any
 * Model Context Protocol server from the command line.
 *
 * It spawns the given command, performs the standard handshake
 * (`initialize` → `notifications/initialized`), lists the server's tools and
 * optionally invokes one or more tools with `--call`.
 *
 * Usage:
 *   node probe.mjs -- node path/to/server.mjs
 *   node probe.mjs -- node path/to/server.mjs --call echo '{"text":"hi"}'
 *   node probe.mjs --timeout-ms 5000 -- node path/to/server.mjs
 *
 * Exit codes:
 *   0   handshake succeeded (and any requested tool call succeeded)
 *   1   protocol failure: bad handshake, invalid JSON-RPC response, tool error
 *   2   usage error: missing command or invalid option
 *   124 timed out waiting for the server (the child is killed)
 *
 * @module mcp-probe
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Default guard for the whole probe run, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15000;

/** Protocol revision requested from the server. */
const PROTOCOL_VERSION = '2025-06-18';

/** Client identity sent in `initialize`. */
const CLIENT_INFO = Object.freeze({ name: 'mcp-probe', version: '0.1.0' });

/** Bytes of server stderr kept for diagnostics when something fails. */
const STDERR_TAIL_BYTES = 8000;

/** Usage text printed by `--help` and on usage errors. */
const USAGE = [
  'Usage: node probe.mjs [options] -- <command> [args...]',
  '',
  'Spawns an MCP stdio server, performs initialize + tools/list and prints the tool names.',
  '',
  'Options:',
  '  --call <tool> [<json-args>]  Also invoke a tool (may be repeated). args default to {}.',
  '  --timeout-ms <number>        Overall timeout in ms; kills the child (default 15000).',
  '  --protocol-version <rev>     Protocol revision to request (default 2025-06-18).',
  '  -h, --help                   Show this help text.',
  '',
  'Exit codes: 0 ok, 1 protocol failure, 2 usage error, 124 timeout.',
  '',
].join('\n');

/** Probe-level failure with a user facing message. */
class ProbeError extends Error {}

/** Probe-level timeout, reported with exit code 124. */
class ProbeTimeoutError extends ProbeError {}

/**
 * Determine whether a CLI token looks like a JSON tool-arguments payload.
 *
 * @param {string} value Token to inspect.
 * @returns {boolean} True when the token starts a JSON object or array.
 */
function looksLikeJson(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Parse the probe's command line into probe options and the child command.
 *
 * Probe options are recognised anywhere in argv (before or after `--`, and even
 * after the child command) so that
 * `probe.mjs -- node server.mjs --call echo '{"text":"hi"}'` works as expected.
 * Every other token becomes part of the spawned command line; flags that are
 * not probe options are forwarded to the child, starting from the first
 * non-option token or after a `--` separator.
 *
 * @param {string[]} argv Raw command line arguments (without node and script).
 * @returns {{
 *   command: string | undefined,
 *   args: string[],
 *   calls: Array<{ name: string, args: Record<string, unknown> }>,
 *   timeoutMs: number,
 *   protocolVersion: string,
 *   help: boolean,
 *   errors: string[],
 * }} Parsed options.
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const child = [];
  /** @type {Array<{ name: string, args: Record<string, unknown> }>} */
  const calls = [];
  /** @type {string[]} */
  const errors = [];
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let protocolVersion = PROTOCOL_VERSION;
  let help = false;
  let afterSeparator = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--') {
      afterSeparator = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }

    if (token === '--timeout-ms' || token.startsWith('--timeout-ms=')) {
      const raw = token.startsWith('--timeout-ms=') ? token.slice('--timeout-ms='.length) : argv[++index];
      const parsed = Number(raw);
      if (typeof raw !== 'string' || raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
        errors.push(`--timeout-ms expects a positive number, got ${JSON.stringify(raw)}`);
      } else {
        timeoutMs = Math.floor(parsed);
      }
      continue;
    }

    if (token === '--protocol-version' || token.startsWith('--protocol-version=')) {
      const raw = token.startsWith('--protocol-version=') ? token.slice('--protocol-version='.length) : argv[++index];
      if (typeof raw !== 'string' || raw.trim() === '') {
        errors.push('--protocol-version expects a value');
      } else {
        protocolVersion = raw.trim();
      }
      continue;
    }

    if (token === '--call' || token.startsWith('--call=')) {
      const name = token.startsWith('--call=') ? token.slice('--call='.length) : argv[++index];
      if (typeof name !== 'string' || name.trim() === '') {
        errors.push('--call expects a tool name');
        continue;
      }
      /** @type {Record<string, unknown>} */
      let toolArgs = {};
      const next = argv[index + 1];
      if (typeof next === 'string' && !next.startsWith('-') && looksLikeJson(next)) {
        try {
          const parsed = JSON.parse(next);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('arguments must be a JSON object');
          }
          toolArgs = parsed;
          index += 1;
        } catch (error) {
          errors.push(`--call ${name}: invalid JSON arguments (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      calls.push({ name, args: toolArgs });
      continue;
    }

    if (token.startsWith('-') && token !== '-') {
      if (child.length > 0 || afterSeparator) {
        // Not a probe option: forward the flag to the spawned server command.
        child.push(token);
      } else {
        errors.push(`unknown option: ${token}`);
      }
      continue;
    }

    child.push(token);
  }

  return {
    command: child[0],
    args: child.slice(1),
    calls,
    timeoutMs,
    protocolVersion,
    help,
    errors,
  };
}

/**
 * Resolve a command name to an executable path. `node` is mapped to the exact
 * Node.js binary running the probe so the probe cannot accidentally spawn a
 * different runtime than the one it was launched with.
 *
 * @param {string} command Command name from the command line.
 * @returns {string} Executable path or the original command.
 */
function resolveExecutable(command) {
  const base = path.basename(command).toLowerCase();
  if (base === 'node' || base === 'node.exe' || base === 'nodejs' || base === 'nodejs.exe') {
    return process.execPath;
  }
  return command;
}

/**
 * Format a JSON-RPC error object for terminal output.
 *
 * @param {unknown} error JSON-RPC error value.
 * @returns {string} One-line description.
 */
function formatRpcError(error) {
  if (error === null || typeof error !== 'object') return String(error);
  const code = Object.prototype.hasOwnProperty.call(error, 'code') ? ` (${error.code})` : '';
  const message = typeof error.message === 'string' ? error.message : JSON.stringify(error);
  return `${message}${code}`;
}

/**
 * Truncate a string for inclusion in an error message.
 *
 * @param {string} value Text to truncate.
 * @param {number} [max] Maximum length (default 400).
 * @returns {string} Possibly truncated text.
 */
function truncate(value, max = 400) {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * Render MCP tool result content blocks as a single line of text.
 *
 * @param {unknown[]} content Content blocks returned by `tools/call`.
 * @returns {string} Human readable rendering.
 */
function renderContent(content) {
  if (content.length === 0) return '(no content)';
  return content
    .map((block) => {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      return JSON.stringify(block);
    })
    .join('\n');
}

/**
 * Wait for a child process to exit, with a bounded timeout.
 *
 * @param {import('node:child_process').ChildProcess} child Child process.
 * @param {number} timeoutMs Maximum wait in milliseconds.
 * @returns {Promise<boolean>} True when the child exited before the timeout.
 */
function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/**
 * Validate the result of an `initialize` response.
 *
 * @param {unknown} result The `result` field of the initialize response.
 * @returns {{ protocolVersion: string, serverInfo: { name?: string, version?: string } }} Validated result.
 */
function validateInitialize(result) {
  if (result === null || typeof result !== 'object') {
    throw new ProbeError('invalid initialize response: "result" is not an object');
  }
  const candidate = /** @type {{ protocolVersion?: unknown, capabilities?: unknown, serverInfo?: unknown }} */ (result);
  if (typeof candidate.protocolVersion !== 'string' || candidate.protocolVersion === '') {
    throw new ProbeError('invalid initialize response: missing "protocolVersion" string');
  }
  if (candidate.capabilities === null || typeof candidate.capabilities !== 'object') {
    throw new ProbeError('invalid initialize response: missing "capabilities" object');
  }
  if (candidate.serverInfo === null || typeof candidate.serverInfo !== 'object') {
    throw new ProbeError('invalid initialize response: missing "serverInfo" object');
  }
  const serverInfo = /** @type {{ name?: unknown, version?: unknown }} */ (candidate.serverInfo);
  if (typeof serverInfo.name !== 'string' || serverInfo.name === '') {
    throw new ProbeError('invalid initialize response: missing "serverInfo.name" string');
  }
  return {
    protocolVersion: candidate.protocolVersion,
    serverInfo: {
      name: serverInfo.name,
      version: typeof serverInfo.version === 'string' ? serverInfo.version : 'unknown',
    },
  };
}

/**
 * Validate the result of a `tools/list` response and return the tool names.
 *
 * @param {unknown} result The `result` field of the tools/list response.
 * @returns {string[]} Tool names in server order.
 */
function validateToolsList(result) {
  if (result === null || typeof result !== 'object' || !Array.isArray(/** @type {{ tools?: unknown }} */ (result).tools)) {
    throw new ProbeError('invalid tools/list response: "result.tools" is not an array');
  }
  /** @type {string[]} */
  const names = [];
  const tools = /** @type {Array<Record<string, unknown>>} */ (/** @type {{ tools: unknown[] }} */ (result).tools);
  for (const [index, tool] of tools.entries()) {
    if (tool === null || typeof tool !== 'object' || typeof tool.name !== 'string' || tool.name === '') {
      throw new ProbeError(`invalid tools/list response: entry ${index} is missing a "name" string`);
    }
    if (tool.inputSchema !== undefined && (tool.inputSchema === null || typeof tool.inputSchema !== 'object')) {
      throw new ProbeError(`invalid tools/list response: tool "${tool.name}" has a non-object "inputSchema"`);
    }
    names.push(tool.name);
  }
  return names;
}

/**
 * Minimal strict MCP stdio client: newline-delimited JSON-RPC 2.0 over the
 * child's stdin/stdout, with correlated request/response ids.
 */
class StdioProbe {
  /**
   * @param {{ command: string, args: string[], timeoutMs: number }} options Spawn options.
   */
  constructor({ command, args, timeoutMs }) {
    this.command = command;
    this.args = args;
    this.timeoutMs = timeoutMs;
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;
    this.buffer = '';
    /** @type {Map<string | number | null, { method: string, resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
    this.pending = new Map();
    this.nextId = 1;
    this.stderrTail = '';
    this.closing = false;
    /** @type {Error | null} */
    this.fatal = null;
    this.timedOut = false;
    /** @type {NodeJS.Timeout | null} */
    this.deadline = null;
  }

  /**
   * Spawn the server and start reading its stdout.
   *
   * @returns {Promise<void>} Resolves once the child process has spawned.
   */
  start() {
    return new Promise((resolve, reject) => {
      const executable = resolveExecutable(this.command);
      const child = spawn(executable, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: process.cwd(),
        env: process.env,
      });
      this.child = child;

      child.once('spawn', () => {
        this.deadline = setTimeout(() => this.onTimeout(), this.timeoutMs);
        resolve();
      });
      child.once('error', (error) => {
        reject(new ProbeError(`failed to spawn "${this.command}": ${error.message}`));
      });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.onStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
      });
      child.once('exit', (code, signal) => this.onChildExit(code, signal));
      child.stdin.on('error', () => {
        // Writes to a closed child stdin are surfaced by the write callback or exit handler.
      });
    });
  }

  /**
   * Handle a chunk of server stdout, splitting it into newline-delimited frames.
   *
   * @param {string} chunk UTF-8 decoded chunk.
   * @returns {void}
   */
  onStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.onLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  /**
   * Handle one stdout line. Blank lines are tolerated, anything that is not
   * valid JSON-RPC is a fatal protocol failure.
   *
   * @param {string} line Line without the trailing newline.
   * @returns {void}
   */
  onLine(line) {
    if (line.trim() === '') return;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.fail(new ProbeError(`server wrote invalid JSON to stdout: ${truncate(line)}`));
      return;
    }
    this.onMessage(parsed);
  }

  /**
   * Handle one decoded JSON-RPC message from the server.
   *
   * @param {unknown} message Decoded message.
   * @returns {void}
   */
  onMessage(message) {
    if (Array.isArray(message)) {
      for (const item of message) this.onMessage(item);
      return;
    }
    if (message === null || typeof message !== 'object' || /** @type {{ jsonrpc?: unknown }} */ (message).jsonrpc !== '2.0') {
      this.fail(new ProbeError(`server sent an invalid JSON-RPC message: ${truncate(JSON.stringify(message))}`));
      return;
    }

    const record = /** @type {Record<string, unknown>} */ (message);

    if (typeof record.method === 'string') {
      // Server-to-client request or notification. Answer requests so the server
      // cannot hang, and ignore notifications.
      if (Object.prototype.hasOwnProperty.call(record, 'id') && record.id !== undefined) {
        this.send({
          jsonrpc: '2.0',
          id: record.id,
          error: { code: -32601, message: `Method not found: ${record.method}` },
        }).catch(() => {
          // The run is already failing; the exit path reports it.
        });
      }
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(record, 'id')) {
      this.fail(new ProbeError(`server sent an invalid JSON-RPC message: ${truncate(JSON.stringify(record))}`));
      return;
    }

    const hasResult = Object.prototype.hasOwnProperty.call(record, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(record, 'error');
    if (hasResult === hasError) {
      this.fail(new ProbeError(`response ${JSON.stringify(record.id)} must contain exactly one of "result" or "error"`));
      return;
    }

    const id = /** @type {string | number | null} */ (record.id);
    const pending = this.pending.get(id);
    if (!pending) {
      this.fail(new ProbeError(`received a response for unknown request id ${JSON.stringify(record.id)}`));
      return;
    }
    this.pending.delete(id);
    if (hasError) {
      pending.reject(new ProbeError(`"${pending.method}" failed: ${formatRpcError(record.error)}`));
    } else {
      pending.resolve(record.result);
    }
  }

  /**
   * Feed one request into the pending map and write it to the child.
   *
   * @param {string} method MCP method name.
   * @param {unknown} params Request params.
   * @returns {Promise<unknown>} The response `result`.
   */
  request(method, params) {
    if (this.fatal) return Promise.reject(this.fatal);
    if (this.timedOut) return Promise.reject(new ProbeTimeoutError(`timed out after ${this.timeoutMs}ms`));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new ProbeError(String(error)));
      });
    });
  }

  /**
   * Send a JSON-RPC notification (no id, no response expected).
   *
   * @param {string} method MCP method name.
   * @param {unknown} [params] Notification params.
   * @returns {Promise<void>} Resolves once the line has been flushed to the child.
   */
  notify(method, params) {
    return this.send({ jsonrpc: '2.0', method, params });
  }

  /**
   * Write a single JSON line to the child's stdin.
   *
   * @param {Record<string, unknown>} message JSON-RPC message.
   * @returns {Promise<void>} Resolves once the write callback fires.
   */
  send(message) {
    const child = this.child;
    if (!child || this.fatal) {
      return Promise.reject(this.fatal ?? new ProbeError('probe is not running'));
    }
    return new Promise((resolve, reject) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) {
            reject(new ProbeError(`failed to write to server stdin: ${error.message}`));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(new ProbeError(`failed to write to server stdin: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  /**
   * Fail the whole probe run: record the cause, reject every pending request.
   *
   * @param {Error} error Cause.
   * @returns {void}
   */
  fail(error) {
    if (!this.fatal) this.fatal = error;
    for (const [, pending] of this.pending) pending.reject(this.fatal);
    this.pending.clear();
  }

  /**
   * Global timeout handler: kill the child and reject pending requests.
   *
   * @returns {void}
   */
  onTimeout() {
    if (this.closing) return;
    this.timedOut = true;
    this.fail(new ProbeTimeoutError(`timed out after ${this.timeoutMs}ms waiting for the MCP server`));
    try {
      this.child?.kill('SIGKILL');
    } catch {
      // The child may already be gone; the caller still reports the timeout.
    }
  }

  /**
   * Handle unexpected child exit.
   *
   * @param {number | null} code Exit code.
   * @param {NodeJS.Signals | null} signal Exit signal.
   * @returns {void}
   */
  onChildExit(code, signal) {
    if (this.closing) return;
    const suffix = signal ? `, signal ${signal}` : '';
    this.fail(new ProbeError(`server exited before the probe finished (code ${code}${suffix})`));
  }

  /**
   * Stop the child: close stdin, then escalate termination if needed. Bounded so
   * a misbehaving server cannot hang the probe.
   *
   * @returns {Promise<void>} Resolves once the child has exited or been killed.
   */
  async close() {
    this.closing = true;
    if (this.deadline) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }
    const child = this.child;
    if (!child || child.pid === undefined) return;
    try {
      child.stdin.end();
    } catch {
      // stdin may already be destroyed.
    }
    if (await waitForExit(child, 1500)) return;
    try {
      child.kill();
    } catch {
      // Ignore: we fall through to SIGKILL.
    }
    if (await waitForExit(child, 1000)) return;
    try {
      child.kill('SIGKILL');
    } catch {
      // Ignore: the process is already being torn down by the OS.
    }
    await waitForExit(child, 500);
  }
}

/**
 * Run one `--call` against the server and print its content.
 *
 * @param {StdioProbe} probe Running probe.
 * @param {{ name: string, args: Record<string, unknown> }} call Tool call to make.
 * @returns {Promise<void>} Resolves when the call succeeded.
 */
async function runToolCall(probe, call) {
  const result = await probe.request('tools/call', { name: call.name, arguments: call.args });
  if (result === null || typeof result !== 'object' || !Array.isArray(/** @type {{ content?: unknown }} */ (result).content)) {
    throw new ProbeError(`tools/call "${call.name}" returned an invalid result (missing "content" array)`);
  }
  const record = /** @type {{ content: unknown[], isError?: unknown }} */ (result);
  const rendered = renderContent(record.content);
  if (record.isError === true) {
    throw new ProbeError(`tool "${call.name}" returned isError: ${rendered}`);
  }
  console.log(`[probe] call ${call.name} ${JSON.stringify(call.args)} -> ${rendered}`);
}

/**
 * CLI entry point: parse arguments, run the handshake, list tools, run any
 * requested tool calls and return the process exit code.
 *
 * @param {string[]} [argv] Command line arguments (defaults to `process.argv.slice(2)`).
 * @returns {Promise<number>} Exit code (0, 1, 2 or 124).
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(Array.isArray(argv) ? argv : []);

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.errors.length > 0) {
    for (const error of options.errors) console.error(`[probe] ${error}`);
    process.stderr.write(USAGE);
    return 2;
  }
  if (!options.command) {
    console.error('[probe] missing command — pass the server command after "--"');
    process.stderr.write(USAGE);
    return 2;
  }

  console.log(`[probe] spawn: ${[options.command, ...options.args].join(' ')}`);
  const probe = new StdioProbe({
    command: options.command,
    args: options.args,
    timeoutMs: options.timeoutMs,
  });

  let exitCode = 0;
  try {
    await probe.start();

    const initialize = validateInitialize(
      await probe.request('initialize', {
        protocolVersion: options.protocolVersion,
        capabilities: {},
        clientInfo: { ...CLIENT_INFO },
      }),
    );
    console.log(
      `[probe] initialize ok: protocol=${initialize.protocolVersion} server=${initialize.serverInfo.name}@${initialize.serverInfo.version}`,
    );

    await probe.notify('notifications/initialized');

    const toolNames = validateToolsList(await probe.request('tools/list', {}));
    console.log(`[probe] tools (${toolNames.length}): ${toolNames.length > 0 ? toolNames.join(', ') : '(none)'}`);

    for (const call of options.calls) {
      await runToolCall(probe, call);
    }

    console.log('[probe] PASS');
  } catch (error) {
    exitCode = error instanceof ProbeTimeoutError ? 124 : 1;
    console.error(`[probe] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    if (probe.stderrTail.trim() !== '') {
      console.error(`[probe] server stderr (tail):\n${probe.stderrTail.trim()}`);
    }
  } finally {
    await probe.close();
  }

  return exitCode;
}

/**
 * Run the CLI when this file is executed directly (not when it is imported).
 *
 * @returns {void}
 */
function runAsCli() {
  const entry = process.argv[1];
  if (!entry) return;
  try {
    const invoked = pathToFileURL(fs.realpathSync(path.resolve(entry))).href;
    const self = pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href;
    const matches = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
    if (!matches) return;
  } catch {
    return;
  }
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[probe] FAIL: unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      process.exitCode = 1;
    });
}

runAsCli();
