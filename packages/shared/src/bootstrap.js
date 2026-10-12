/**
 * Pre-clone appliance bootstrap graph: instance `bootstrap/` directory
 * (`.env.schema` + `.env.<env>`), seeded to `/usr/local/lib/qctl/bootstrap/`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { loadEnvGraphForDir } from './varlock/index.js'
/** @import { LoadGraphOptions } from './varlock/load.js' */

/** Guest install path for the bootstrap schema + env files. */
export const BOOTSTRAP_DIR_DEFAULT = '/usr/local/lib/qctl/bootstrap'

/** Instance-relative directory (source of `.env.dev` / `.env.prod` bindings). */
export const BOOTSTRAP_INSTANCE_DIR = 'bootstrap'

/**
 * Resolve the bootstrap graph directory (guest install or override).
 * @param {string} [dir]
 */
export function resolveBootstrapDir(dir) {
  return dir?.trim() || process.env.QCTL_BOOTSTRAP_DIR?.trim() || BOOTSTRAP_DIR_DEFAULT
}

/**
 * Absolute path to the instance `bootstrap/` directory, if present.
 * @param {string} root instance repo root
 * @returns {string | null}
 */
export function instanceBootstrapDir(root) {
  const dir = join(root, BOOTSTRAP_INSTANCE_DIR)
  return existsSync(dir) ? dir : null
}

/**
 * Load + resolve the bootstrap graph (schema + `.env.<QCTL_ENV>`).
 * Hydrates `$CREDENTIALS_DIRECTORY` into override values before resolve.
 *
 * @param {LoadGraphOptions & { dir?: string }} [opts]
 */
export async function loadBootstrapGraph(opts = {}) {
  const dir = resolveBootstrapDir(opts.dir)
  if (!existsSync(join(dir, '.env.schema'))) {
    throw new Error(
      `bootstrap schema missing: ${join(dir, '.env.schema')} `
        + `(seed install or create .env.schema under the bootstrap dir)`,
    )
  }
  return loadEnvGraphForDir(dir, opts)
}
