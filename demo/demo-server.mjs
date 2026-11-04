#!/usr/bin/env node
/**
 * Dependency-free demo Model Context Protocol (MCP) server over stdio.
 *
 * Framing: exactly one JSON-RPC 2.0 object per line on stdout. Nothing else is
 * ever written to stdout — diagnostics go to stderr. Requests are read from
 * stdin line by line, and an EOF on stdin shuts the server down cleanly (exit
 * code 0). The server is intentionally dependency-free so it can prove the MCP
 * pipeline end to end without a network or an npm install.
 *
 * Run directly:
 *   node demo-server.mjs              # serve MCP over stdio
 *   node demo-server.mjs --selftest   # run the built-in protocol checks
 *
 * @module dsh-mcp-center/demo/demo-server
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @typedef {object} JsonRpcError
 * @property {number} code JSON-RPC error code.
 * @property {string} message Human readable error message.
 * @property {unknown} [data] Optional additional error data.
 */

/**
 * @typedef {object} JsonRpcResponse
 * @property {'2.0'} jsonrpc JSON-RPC version marker.
 * @property {string | number | null} id Request id echoed by the server.
 * @property {unknown} [result] Successful result payload.
 * @property {JsonRpcError} [error] Error payload (mutually exclusive with result).
 */

/** MCP server name announced in `initialize`. */
export const SERVER_NAME = 'mcp-center-demo';

/** MCP server version announced in `initialize`. */
export const SERVER_VERSION = '0.1.0';

/** Protocol revision used when a client requests an unknown revision. */
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

/** Protocol revisions this demo server understands. */
export const KNOWN_PROTOCOL_VERSIONS = Object.freeze([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);

/** Frozen `serverInfo` announced in `initialize`. */
export const SERVER_INFO = Object.freeze({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

/** JSON-RPC / MCP error codes used by this server. */
const ErrorCode = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RESOURCE_NOT_FOUND: -32002,
});

/** Message used for the `demo://readme` resource. */
const README_TEXT = [
  '# MCP Center demo server',
  '',
  'A dependency-free Model Context Protocol server over stdio. It ships with the',
  '`dsh-mcp-center` plugin so the MCP pipeline can be exercised offline.',
  '',
  '## Run',
  '',
  '- `node demo-server.mjs` — serve MCP on stdin/stdout (newline-delimited JSON-RPC 2.0).',
  '- `node demo-server.mjs --selftest` — run the built-in checks, non-zero exit on failure.',
  '',
  '## Tools',
  '',
  '- `echo` — return the provided text.',
  '- `add` — add two numbers.',
  '- `now` — return the current ISO timestamp and the process platform.',
  '- `list_dir` — list the sorted entry names of a directory (read-only).',
  '',
  '## Resources',
  '',
  '- `demo://readme` — this document.',
  '- `demo://env` — a JSON summary of the server process environment.',
  '',
  'Stdout carries protocol messages only; diagnostics are written to stderr.',
].join('\n');

/**
 * Tool definitions advertised by `tools/list`.
 *
 * @type {ReadonlyArray<{ name: string, description: string, inputSchema: object }>}
 */
export const TOOLS = Object.freeze([
  Object.freeze({
    name: 'echo',
    description: 'Echo the provided text back to the caller.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to echo back.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: 'add',
    description: 'Add two numbers and return the sum as text.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First addend.' },
        b: { type: 'number', description: 'Second addend.' },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: 'now',
    description: 'Return the current ISO timestamp and the server process platform.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  }),
  Object.freeze({
    name: 'list_dir',
    description: 'List the sorted entry names of a directory (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  }),
]);

/**
 * Resource definitions advertised by `resources/list`.
 *
 * @type {ReadonlyArray<{ uri: string, name: string, title: string, description: string, mimeType: string }>}
 */
export const RESOURCES = Object.freeze([
  Object.freeze({
    uri: 'demo://readme',
    name: 'readme',
    title: 'MCP Center demo server readme',
    description: 'Documentation for the bundled demo MCP server, its tools and its resources.',
    mimeType: 'text/markdown',
  }),
  Object.freeze({
    uri: 'demo://env',
    name: 'env',
    title: 'Demo server environment summary',
    description: 'Read-only JSON summary of the demo server process environment.',
    mimeType: 'application/json',
  }),
]);

/** Error thrown by a tool implementation; turned into an `isError` tool result. */
class ToolError extends Error {}

/**
 * Build a successful JSON-RPC response.
 *
 * @param {string | number | null} id Request id.
 * @param {unknown} result Result payload.
 * @returns {JsonRpcResponse} JSON-RPC response.
 */
function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build a JSON-RPC error response.
 *
 * @param {string | number | null} id Request id (null when it cannot be determined).
 * @param {number} code JSON-RPC error code.
 * @param {string} message Error message.
 * @param {unknown} [data] Optional additional error data.
 * @returns {JsonRpcResponse} JSON-RPC response.
 */
function jsonRpcError(id, code, message, data) {
  /** @type {JsonRpcError} */
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

/**
 * Determine whether a value is a non-array object.
 *
 * @param {unknown} value Value to inspect.
 * @returns {value is Record<string, unknown>} True for plain objects.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Build a text-only tool result.
 *
 * @param {string} text Text content.
 * @param {boolean} [isError] Whether this result reports a tool execution error.
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError?: true }} Tool result.
 */
function textResult(text, isError = false) {
  /** @type {{ content: Array<{ type: 'text', text: string }>, isError?: true }} */
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return result;
}

/**
 * Read a resource URI and return its text content.
 *
 * @param {string} uri Resource URI to read.
 * @returns {string | null} Text content, or null when the URI is unknown.
 */
function readResourceText(uri) {
  if (uri === 'demo://readme') return README_TEXT;
  if (uri === 'demo://env') {
    /** @type {Record<string, unknown>} */
    const summary = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      pid: process.pid,
      cwd: process.cwd(),
      envVarCount: Object.keys(process.env).length,
      argv: process.argv.slice(0, 2),
    };
    return `${JSON.stringify(summary, null, 2)}\n`;
  }
  return null;
}

/**
 * Tool implementations keyed by tool name. Each handler returns the text that
 * is placed in the tool result and throws `ToolError` for execution errors.
 *
 * @type {Readonly<Record<string, (args: Record<string, unknown>) => string>>}
 */
const TOOL_HANDLERS = Object.freeze({
  echo(args) {
    if (typeof args.text !== 'string') {
      throw new ToolError('argument "text" must be a string');
    }
    return args.text;
  },

  add(args) {
    if (
      typeof args.a !== 'number' ||
      typeof args.b !== 'number' ||
      !Number.isFinite(args.a) ||
      !Number.isFinite(args.b)
    ) {
      throw new ToolError('arguments "a" and "b" must both be finite numbers');
    }
    return String(args.a + args.b);
  },

  now() {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: process.platform,
    });
  },

  list_dir(args) {
    if (typeof args.path !== 'string' || args.path.trim() === '') {
      throw new ToolError('argument "path" must be a non-empty string');
    }
    const target = path.resolve(args.path);
    /** @type {import('node:fs').Stats} */
    let stats;
    try {
      stats = fs.statSync(target);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        throw new ToolError(`directory not found: ${target}`);
      }
      throw new ToolError(`cannot access ${target}: ${error.code ?? error.message}`);
    }
    if (!stats.isDirectory()) {
      throw new ToolError(`not a directory: ${target}`);
    }
    /** @type {string[]} */
    let entries;
    try {
      entries = fs.readdirSync(target);
    } catch (error) {
      throw new ToolError(`cannot read ${target}: ${error.code ?? error.message}`);
    }
    entries.sort();
    return entries.length === 0 ? '(empty directory)' : entries.join('\n');
  },
});

/**
 * Build the `initialize` result for a request, negotiating the protocol
 * revision: a known requested revision is echoed, anything else falls back to
 * `2024-11-05`.
 *
 * @param {unknown} params `initialize` request params.
 * @returns {{ protocolVersion: string, capabilities: { tools: object, resources: object }, serverInfo: { name: string, version: string } }} Initialize result.
 */
function createInitializeResult(params) {
  const requested = isPlainObject(params) ? params.protocolVersion : undefined;
  const protocolVersion =
    typeof requested === 'string' && KNOWN_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : DEFAULT_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
}

/**
 * Execute a `tools/call` request. Tool execution failures are reported as
 * `{ content, isError: true }` results, never as transport-level errors.
 *
 * @param {string | number | null} id Request id.
 * @param {unknown} params `tools/call` request params.
 * @returns {JsonRpcResponse} JSON-RPC response.
 */
function handleToolCall(id, params) {
  if (!isPlainObject(params) || typeof params.name !== 'string' || params.name === '') {
    return jsonRpcError(id, ErrorCode.INVALID_PARAMS, 'tools/call requires a tool "name" string');
  }
  const name = params.name;
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isPlainObject(args)) {
    return jsonRpcError(id, ErrorCode.INVALID_PARAMS, 'tools/call "arguments" must be an object');
  }
  const handler = TOOL_HANDLERS[name];
  if (typeof handler !== 'function') {
    return jsonRpcResult(id, textResult(`MCP tool error: unknown tool "${name}"`, true));
  }
  try {
    return jsonRpcResult(id, textResult(handler(args)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonRpcResult(id, textResult(`MCP tool error: ${message}`, true));
  }
}

/**
 * Handle a `resources/read` request.
 *
 * @param {string | number | null} id Request id.
 * @param {unknown} params `resources/read` request params.
 * @returns {JsonRpcResponse} JSON-RPC response.
 */
function handleResourceRead(id, params) {
  if (!isPlainObject(params) || typeof params.uri !== 'string' || params.uri === '') {
    return jsonRpcError(id, ErrorCode.INVALID_PARAMS, 'resources/read requires a "uri" string');
  }
  const resource = RESOURCES.find((candidate) => candidate.uri === params.uri);
  if (!resource) {
    return jsonRpcError(id, ErrorCode.RESOURCE_NOT_FOUND, `Resource not found: ${params.uri}`);
  }
  const text = readResourceText(resource.uri);
  if (text === null) {
    return jsonRpcError(id, ErrorCode.RESOURCE_NOT_FOUND, `Resource not found: ${params.uri}`);
  }
  return jsonRpcResult(id, {
    contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }],
  });
}

/**
 * Create the in-process MCP server. The returned object accepts either whole
 * JSON-RPC messages (`handleMessage`) or raw stdin lines (`handleLine`) and is
 * fully synchronous, which is what makes the built-in self test possible.
 *
 * `handleLine` returns an array of responses so batches and notifications can be
 * expressed uniformly: notifications produce no response at all.
 *
 * @returns {{
 *   handleMessage: (message: unknown) => JsonRpcResponse | null,
 *   handleLine: (line: string) => JsonRpcResponse[],
 * }} Server instance.
 */
export function createDemoServer() {
  /**
   * Handle one decoded JSON-RPC message.
   *
   * @param {unknown} message Decoded JSON-RPC message.
   * @returns {JsonRpcResponse | null} Response, or null for notifications.
   */
  function handleMessage(message) {
    if (!isPlainObject(message)) {
      return jsonRpcError(null, ErrorCode.INVALID_REQUEST, 'Invalid Request: message must be an object');
    }
    const isNotification = !Object.prototype.hasOwnProperty.call(message, 'id');
    const id = isNotification ? null : message.id;
    if (!isNotification && id !== null && typeof id !== 'string' && typeof id !== 'number') {
      return jsonRpcError(null, ErrorCode.INVALID_REQUEST, 'Invalid Request: "id" must be a string, number or null');
    }
    if (message.jsonrpc !== '2.0') {
      return isNotification ? null : jsonRpcError(id, ErrorCode.INVALID_REQUEST, 'Invalid Request: expected "jsonrpc": "2.0"');
    }
    if (typeof message.method !== 'string' || message.method === '') {
      return isNotification ? null : jsonRpcError(id, ErrorCode.INVALID_REQUEST, 'Invalid Request: "method" must be a non-empty string');
    }
    if (isNotification) {
      // Notifications (e.g. notifications/initialized) never receive a reply.
      return null;
    }
    try {
      switch (message.method) {
        case 'initialize':
          return jsonRpcResult(id, createInitializeResult(message.params));
        case 'ping':
          return jsonRpcResult(id, {});
        case 'tools/list':
          return jsonRpcResult(id, {
            tools: TOOLS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          });
        case 'tools/call':
          return handleToolCall(id, message.params);
        case 'resources/list':
          return jsonRpcResult(id, {
            resources: RESOURCES.map((resource) => ({ ...resource })),
          });
        case 'resources/read':
          return handleResourceRead(id, message.params);
        case 'resources/templates/list':
          return jsonRpcResult(id, { resourceTemplates: [] });
        default:
          return jsonRpcError(id, ErrorCode.METHOD_NOT_FOUND, `Method not found: ${message.method}`);
      }
    } catch (error) {
      // A handler bug must never crash the transport: report a JSON-RPC internal error.
      const detail = error instanceof Error ? error.message : String(error);
      return jsonRpcError(id, ErrorCode.INTERNAL_ERROR, `Internal error: ${detail}`);
    }
  }

  /**
   * Handle one raw line from stdin. Blank lines are ignored, malformed JSON
   * yields a parse-error response, and JSON-RPC batches are expanded.
   *
   * @param {string} line Raw input line (without the trailing newline).
   * @returns {JsonRpcResponse[]} Zero or more responses to write to stdout.
   */
  function handleLine(line) {
    const raw = typeof line === 'string' ? line.replace(/^\uFEFF/, '').trim() : '';
    if (raw === '') return [];
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [jsonRpcError(null, ErrorCode.PARSE_ERROR, `Parse error: ${error.message}`)];
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return [jsonRpcError(null, ErrorCode.INVALID_REQUEST, 'Invalid Request: empty batch')];
      }
      /** @type {JsonRpcResponse[]} */
      const responses = [];
      for (const item of parsed) {
        const response = handleMessage(item);
        if (response) responses.push(response);
      }
      return responses;
    }
    const response = handleMessage(parsed);
    return response ? [response] : [];
  }

  return { handleMessage, handleLine };
}

/**
 * Attach the demo server to a stdio pair. Each request line is answered with a
 * single line of JSON on the output stream; stdin EOF closes the server and
 * exits with code 0 once pending output has been flushed.
 *
 * @param {object} [options] Transport options.
 * @param {NodeJS.ReadableStream} [options.input] Input stream (defaults to stdin).
 * @param {NodeJS.WritableStream} [options.output] Output stream (defaults to stdout).
 * @param {NodeJS.WritableStream} [options.errorOutput] Diagnostic stream (defaults to stderr).
 * @returns {{ server: ReturnType<typeof createDemoServer>, close: () => void }} Transport handle.
 */
export function createStdioTransport(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const server = createDemoServer();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let closed = false;

  /**
   * Write one protocol response as a single newline-terminated JSON line.
   *
   * @param {JsonRpcResponse} response Response to write.
   * @returns {void}
   */
  function writeResponse(response) {
    if (closed) return;
    try {
      output.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      errorOutput.write(`[mcp-center-demo] failed to write response: ${error.message}\n`);
    }
  }

  rl.on('line', (line) => {
    for (const response of server.handleLine(line)) {
      writeResponse(response);
    }
  });

  rl.on('close', () => {
    // stdin reached EOF: stop reading and let Node exit cleanly once stdout flushes.
    closed = true;
    process.exitCode = 0;
  });

  input.on('error', (error) => {
    errorOutput.write(`[mcp-center-demo] stdin error: ${error.message}\n`);
  });

  output.on('error', (error) => {
    if (error && error.code === 'EPIPE') {
      process.exit(0);
    }
    errorOutput.write(`[mcp-center-demo] stdout error: ${error.message}\n`);
  });

  return { server, close: () => rl.close() };
}

/**
 * Run the built-in self test: feed the real handlers a series of protocol
 * requests and verify the responses. Diagnostics are written to stderr only.
 *
 * @returns {number} 0 when every check passes, 1 otherwise.
 */
export function runSelfTest() {
  /** @type {string[]} */
  const failures = [];
  let checks = 0;

  /**
   * Record one check.
   *
   * @param {string} label Check description.
   * @param {boolean} condition Check outcome.
   * @param {string} [detail] Extra detail shown when the check fails.
   * @returns {void}
   */
  const record = (label, condition, detail) => {
    checks += 1;
    if (!condition) failures.push(detail ? `${label} [${detail}]` : label);
  };

  const server = createDemoServer();
  let nextId = 1;

  /**
   * Invoke a request against the in-process server and return the response.
   *
   * @param {string} method MCP method name.
   * @param {unknown} [params] Request params.
   * @returns {JsonRpcResponse} JSON-RPC response.
   */
  const request = (method, params) => {
    const id = nextId;
    nextId += 1;
    const response = server.handleMessage({ jsonrpc: '2.0', id, method, params });
    if (!response) throw new Error(`no response for request ${method}`);
    return response;
  };

  /**
   * Extract a response result.
   *
   * @param {JsonRpcResponse} response JSON-RPC response.
   * @returns {unknown} The `result` field, if any.
   */
  const resultOf = (response) => (response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : undefined);

  /**
   * Extract a response error.
   *
   * @param {JsonRpcResponse} response JSON-RPC response.
   * @returns {JsonRpcError | undefined} The `error` field, if any.
   */
  const errorOf = (response) => (response && Object.prototype.hasOwnProperty.call(response, 'error') ? response.error : undefined);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-center-demo-selftest-'));

  try {
    // --- initialize -------------------------------------------------------
    const init = resultOf(
      request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'demo-selftest', version: '0.1.0' },
      }),
    );
    record('initialize echoes a known protocol revision', init?.protocolVersion === '2025-06-18', String(init?.protocolVersion));
    record(
      'initialize declares tools and resources capabilities',
      isPlainObject(init?.capabilities?.tools) && isPlainObject(init?.capabilities?.resources),
    );
    record('initialize capability shape is exact', JSON.stringify(init?.capabilities) === '{"tools":{},"resources":{}}');
    record(
      'initialize reports serverInfo mcp-center-demo@0.1.0',
      init?.serverInfo?.name === SERVER_NAME && init?.serverInfo?.version === SERVER_VERSION,
    );

    const legacyInit = resultOf(request('initialize', { protocolVersion: '1999-01-01' }));
    record('initialize falls back to 2024-11-05 for unknown revisions', legacyInit?.protocolVersion === '2024-11-05', String(legacyInit?.protocolVersion));
    const bareInit = resultOf(request('initialize', {}));
    record('initialize falls back to 2024-11-05 without a revision', bareInit?.protocolVersion === '2024-11-05');

    // --- notifications / ping --------------------------------------------
    const initializedResponses = server.handleLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    );
    record('notifications/initialized gets no response', initializedResponses.length === 0);
    const cancelledResponses = server.handleLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }),
    );
    record('other notifications get no response', cancelledResponses.length === 0);

    const ping = resultOf(request('ping'));
    record('ping returns an empty result object', isPlainObject(ping) && Object.keys(ping).length === 0);

    // --- tools/list -------------------------------------------------------
    const tools = resultOf(request('tools/list'))?.tools ?? [];
    const toolNames = tools.map((tool) => tool?.name);
    const requiredTools = ['echo', 'add', 'now', 'list_dir'];
    record('tools/list exposes echo/add/now/list_dir', requiredTools.every((name) => toolNames.includes(name)), toolNames.join(','));
    record('tools/list tools all declare an object inputSchema', tools.length > 0 && tools.every((tool) => tool?.inputSchema?.type === 'object'));
    record(
      'echo inputSchema requires text',
      JSON.stringify(tools.find((tool) => tool?.name === 'echo')?.inputSchema?.required) === '["text"]',
    );
    record(
      'add inputSchema requires a and b',
      JSON.stringify(tools.find((tool) => tool?.name === 'add')?.inputSchema?.required) === '["a","b"]',
    );
    record(
      'list_dir inputSchema requires path',
      JSON.stringify(tools.find((tool) => tool?.name === 'list_dir')?.inputSchema?.required) === '["path"]',
    );

    // --- tools/call -------------------------------------------------------
    const echoResult = resultOf(request('tools/call', { name: 'echo', arguments: { text: 'hi' } }));
    record(
      'tools/call echo returns the provided text',
      echoResult?.content?.[0]?.type === 'text' && echoResult?.content?.[0]?.text === 'hi' && echoResult?.isError !== true,
    );

    const addResult = resultOf(request('tools/call', { name: 'add', arguments: { a: 2, b: 3 } }));
    record('tools/call add returns the sum', addResult?.content?.[0]?.text === '5', String(addResult?.content?.[0]?.text));

    const nowResult = resultOf(request('tools/call', { name: 'now', arguments: {} }));
    /** @type {Record<string, unknown> | null} */
    let nowPayload = null;
    try {
      nowPayload = JSON.parse(nowResult?.content?.[0]?.text ?? '');
    } catch {
      nowPayload = null;
    }
    record(
      'tools/call now returns an ISO timestamp and the platform',
      typeof nowPayload?.timestamp === 'string' &&
        !Number.isNaN(Date.parse(nowPayload.timestamp)) &&
        nowPayload?.platform === process.platform,
      String(nowResult?.content?.[0]?.text),
    );

    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'b');
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'a');
    fs.mkdirSync(path.join(tempDir, 'sub'));
    const listResult = resultOf(request('tools/call', { name: 'list_dir', arguments: { path: tempDir } }));
    const listedNames = String(listResult?.content?.[0]?.text ?? '').split('\n');
    record(
      'tools/call list_dir returns sorted entry names',
      JSON.stringify(listedNames) === JSON.stringify(['a.txt', 'b.txt', 'sub']),
      listedNames.join(','),
    );

    const missingDirResult = resultOf(
      request('tools/call', { name: 'list_dir', arguments: { path: path.join(tempDir, 'does-not-exist') } }),
    );
    record(
      'list_dir missing path returns a tool error result',
      missingDirResult?.isError === true && String(missingDirResult?.content?.[0]?.text ?? '').length > 0,
    );

    const filePathResult = resultOf(
      request('tools/call', { name: 'list_dir', arguments: { path: path.join(tempDir, 'a.txt') } }),
    );
    record('list_dir file path returns a tool error result', filePathResult?.isError === true);

    const unknownToolResult = resultOf(request('tools/call', { name: 'nope', arguments: {} }));
    record('tools/call unknown tool returns a tool error result', unknownToolResult?.isError === true);
    const missingTextResult = resultOf(request('tools/call', { name: 'echo', arguments: {} }));
    record('tools/call echo without text returns a tool error result', missingTextResult?.isError === true);
    const missingNameError = errorOf(request('tools/call', {}));
    record('tools/call without a name returns -32602', missingNameError?.code === ErrorCode.INVALID_PARAMS);

    // --- resources --------------------------------------------------------
    const resources = resultOf(request('resources/list'))?.resources ?? [];
    const resourceUris = resources.map((resource) => resource?.uri);
    record(
      'resources/list exposes demo://readme and demo://env',
      ['demo://readme', 'demo://env'].every((uri) => resourceUris.includes(uri)),
      resourceUris.join(','),
    );
    record(
      'resources/list entries have name and mimeType',
      resources.length === 2 && resources.every((resource) => typeof resource?.name === 'string' && typeof resource?.mimeType === 'string'),
    );

    const readmeContents = resultOf(request('resources/read', { uri: 'demo://readme' }))?.contents ?? [];
    const readmeText = readmeContents[0]?.text;
    record(
      'resources/read demo://readme returns text mentioning the tools',
      typeof readmeText === 'string' && readmeText.includes('list_dir'),
    );

    const envContents = resultOf(request('resources/read', { uri: 'demo://env' }))?.contents ?? [];
    /** @type {Record<string, unknown> | null} */
    let envPayload = null;
    try {
      envPayload = JSON.parse(envContents[0]?.text ?? '');
    } catch {
      envPayload = null;
    }
    record(
      'resources/read demo://env returns a JSON environment summary',
      envPayload?.platform === process.platform && typeof envPayload?.node === 'string',
    );

    const missingResourceError = errorOf(request('resources/read', { uri: 'demo://missing' }));
    record('resources/read unknown URI returns -32002', missingResourceError?.code === ErrorCode.RESOURCE_NOT_FOUND);

    // --- protocol errors --------------------------------------------------
    const unknownMethodError = errorOf(request('nope/method'));
    record('unknown method returns -32601', unknownMethodError?.code === ErrorCode.METHOD_NOT_FOUND);
    const invalidRequestError = errorOf(server.handleMessage({ jsonrpc: '2.0', id: 99 }));
    record('request without a method returns -32600', invalidRequestError?.code === ErrorCode.INVALID_REQUEST);

    const parseErrorResponses = server.handleLine('{ this is not json');
    record(
      'malformed JSON yields -32700 with a null id',
      parseErrorResponses.length === 1 &&
        parseErrorResponses[0]?.error?.code === ErrorCode.PARSE_ERROR &&
        parseErrorResponses[0]?.id === null,
    );
    record('blank lines are ignored', server.handleLine('   ').length === 0);

    const batchResponses = server.handleLine(
      JSON.stringify([
        { jsonrpc: '2.0', id: 'batch-ping', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'batch-init', method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      ]),
    );
    record(
      'batch requests are answered individually',
      batchResponses.length === 2 && batchResponses[0]?.id === 'batch-ping' && batchResponses[1]?.id === 'batch-init',
    );
  } catch (error) {
    checks += 1;
    failures.push(`unexpected exception: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    process.stderr.write(`[mcp-center-demo] selftest passed (${checks} checks)\n`);
    return 0;
  }
  process.stderr.write(`[mcp-center-demo] selftest FAILED (${failures.length}/${checks} checks)\n`);
  for (const failure of failures) process.stderr.write(`[mcp-center-demo]  - ${failure}\n`);
  return 1;
}

/** Usage text for `--help`; written to stderr so stdout stays protocol-only. */
const USAGE = [
  'Usage: node demo-server.mjs [--selftest] [--help]',
  '',
  '  (no flags)   Serve the MCP demo server on stdin/stdout (newline-delimited JSON-RPC 2.0).',
  '  --selftest   Run the built-in protocol checks; exits non-zero on failure.',
  '  --help       Show this help text.',
  '',
].join('\n');

/**
 * CLI entry point. Serves MCP over stdio by default and runs the built-in self
 * test when `--selftest` is present.
 *
 * @param {string[]} [argv] Command line arguments (defaults to `process.argv.slice(2)`).
 * @returns {number} Exit code: 0 on success, 1 when the self test fails.
 */
export function main(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? argv : [];
  if (args.includes('--selftest')) {
    return runSelfTest();
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stderr.write(USAGE);
    return 0;
  }
  const unknown = args.filter((arg) => arg !== '--');
  if (unknown.length > 0) {
    process.stderr.write(`[mcp-center-demo] ignoring unknown arguments: ${unknown.join(' ')}\n`);
  }
  createStdioTransport();
  return 0;
}

/**
 * Invoke the CLI entry point when this file is executed directly (rather than
 * imported by another module or the self test harness).
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
  const code = main();
  if (code !== 0) process.exitCode = code;
}

runAsCli();
