/**
 * Day-2 identity from `/etc/qctl/config.json` (written by guest init load-seed).
 * Guest commands must not discover root / env / quadlet user from process env.
 */
import { existsSync, readFileSync } from 'node:fs'

import { QCTL_OS_CONFIG_PATH, osConfigSchema } from '@qctl/shared'

/** @import { OsConfig } from '@qctl/shared' */

/**
 * @param {string} [path]
 * @returns {OsConfig}
 */
export function readOsConfig(path = QCTL_OS_CONFIG_PATH) {
  if (!existsSync(path)) {
    throw new Error(`missing OS config ${path} (run guest init / re-seed)`)
  }
  try {
    return osConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    throw new Error(
      `failed to read OS config ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * @param {string} [path]
 * @returns {OsConfig | undefined}
 */
export function tryReadOsConfig(path = QCTL_OS_CONFIG_PATH) {
  if (!existsSync(path)) return undefined
  try {
    return readOsConfig(path)
  } catch {
    return undefined
  }
}
