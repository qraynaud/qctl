/**
 * Resolve the staged thin platform ESM module for dynamic `import()`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Legacy default module name (rocky). Prefer `QCTL_PLATFORM_MODULE` / scan. */
export const PLATFORM_MODULE_NAME = 'qctl-platform-rocky.mjs'

/** Guest install path. Override with QCTL_LIB_DIR. */
export const PLATFORM_LIB_DIR_DEFAULT = '/usr/local/lib/qctl'

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function defaultPlatformModulePath(env = process.env) {
  const lib = (env.QCTL_LIB_DIR || PLATFORM_LIB_DIR_DEFAULT).trim() || PLATFORM_LIB_DIR_DEFAULT
  return join(lib, PLATFORM_MODULE_NAME)
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isReadableFile(p) {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * @param {string} libDir
 * @param {(p: string) => boolean} exists
 * @returns {string[]}
 */
function listPlatformModules(libDir, exists) {
  try {
    return readdirSync(libDir)
      .filter((n) => /^qctl-platform-.+\.mjs$/.test(n))
      .map((n) => join(libDir, n))
      .filter(exists)
  } catch {
    return []
  }
}

/**
 * @typedef {object} ResolveOpts
 * @property {Record<string, string | undefined>} [env]
 * @property {string} [execPath] guest binary path (default: process.execPath)
 * @property {(p: string) => boolean} [exists]
 */

/**
 * Locate the staged platform ESM module:
 *   1. `QCTL_PLATFORM_MODULE`
 *   2. sole `qctl-platform-*.mjs` under `$QCTL_LIB_DIR`
 *   3. legacy `$QCTL_LIB_DIR/qctl-platform-rocky.mjs`
 *   4. next to the guest binary
 *
 * @param {ResolveOpts} [opts]
 * @returns {string} absolute filesystem path
 * @throws {Error} when not found
 */
export function resolvePlatformModule(opts = {}) {
  const env = opts.env ?? process.env
  const exists = opts.exists ?? isReadableFile
  const execPath = opts.execPath ?? process.execPath
  const lib = (env.QCTL_LIB_DIR || PLATFORM_LIB_DIR_DEFAULT).trim() || PLATFORM_LIB_DIR_DEFAULT

  const explicit = env.QCTL_PLATFORM_MODULE?.trim()
  if (explicit) {
    if (!exists(explicit)) {
      throw new Error(`QCTL_PLATFORM_MODULE=${explicit} is not a readable file`)
    }
    return explicit
  }

  const scanned = listPlatformModules(lib, exists)
  if (scanned.length === 1) return scanned[0]
  if (scanned.length > 1) {
    throw new Error(
      `multiple platform modules under ${lib}: ${scanned.map((p) => p.split('/').pop()).join(', ')}.\n`
        + '  Set QCTL_PLATFORM_MODULE to pick one.',
    )
  }

  for (const cand of [
    defaultPlatformModulePath(env),
    join(dirname(execPath), PLATFORM_MODULE_NAME),
  ]) {
    if (exists(cand)) return cand
  }

  throw new Error(
    `qctl-platform-*.mjs not found (set QCTL_PLATFORM_MODULE, or stage it under `
      + `${PLATFORM_LIB_DIR_DEFAULT}/)`,
  )
}

/**
 * File URL suitable for `import()` (Bun/Node).
 * @param {string} absPath
 * @returns {string}
 */
export function platformModuleImportUrl(absPath) {
  return pathToFileURL(absPath).href
}
