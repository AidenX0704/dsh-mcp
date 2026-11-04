/**
 * Copy the version from `package.json` into `dsh.plugin.json`.
 *
 * `npm version` runs this as its `version` script, so the community manifest can
 * never drift from the npm manifest. Deliberately dependency-free, idempotent and
 * quiet when there is nothing to do: it only rewrites the manifest when the
 * version actually changes, and it keeps the 2-space JSON + trailing newline the
 * rest of the repo uses.
 *
 * Run from the repository root (npm sets cwd there):
 *   node scripts/sync-version.mjs
 *
 * Exit codes: 0 = in sync (changed or already current), 1 = manifest missing,
 * unreadable or malformed.
 *
 * @module dsh-mcp-center/scripts/sync-version
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Repo root, resolved from this script so the cwd does not matter. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_FILE = path.join(ROOT, 'package.json')
const MANIFEST_FILE = path.join(ROOT, 'dsh.plugin.json')

/**
 * Print one diagnostic and exit non-zero.
 * @param {string} message what went wrong, in one line.
 * @returns {never} never returns; it terminates the process.
 */
function fail(message) {
  console.error(`sync-version: ${message}`)
  process.exit(1)
}

/**
 * Read and parse a JSON object file, turning every failure mode into one
 * readable message instead of a stack trace.
 * @param {string} file absolute path to read.
 * @param {string} label human-readable name used in error messages.
 * @returns {Record<string, any>} the parsed top-level object.
 */
function readJsonObject(file, label) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return fail(`${label} is missing or unreadable (${file}): ${error.message}`)
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return fail(`${label} is not valid JSON (${file}): ${error.message}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`${label} must contain a JSON object (${file})`)
  }
  return value
}

const pkg = readJsonObject(PACKAGE_FILE, 'package.json')
const version = pkg.version
if (typeof version !== 'string' || version === '') {
  fail('package.json has no non-empty "version" string')
}

const manifest = readJsonObject(MANIFEST_FILE, 'dsh.plugin.json')
if (manifest.version === version) {
  console.log(`sync-version: dsh.plugin.json already at ${version}, nothing to do`)
  process.exit(0)
}

const previous = typeof manifest.version === 'string' ? manifest.version : '(unset)'
manifest.version = version
// Rewriting the whole object keeps key order (JSON.parse preserves it) and
// normalizes formatting, which is what we want for a generated field.
writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`sync-version: dsh.plugin.json ${previous} -> ${version}`)
