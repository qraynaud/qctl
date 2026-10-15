/**
 * Guest loader for seed-injected `/usr/local/lib/rocky/disks.json`.
 * Schema + package hints live in `@qctl/shared`.
 */
import { existsSync } from 'node:fs'

import { disksJsonSchema, disksPackageHints } from '@qctl/shared'

/** @import { DisksJson, DisksPackageHints } from '@qctl/shared' */

export { disksPackageHints }
export const DISKS_JSON_PATH = '/usr/local/lib/rocky/disks.json'

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<DisksJson | null>}
 */
export async function loadDisksJson(env = process.env) {
  const path = env.ROCKY_DISKS_JSON?.trim() || DISKS_JSON_PATH
  if (!existsSync(path)) return null
  try {
    return disksJsonSchema.parse(await Bun.file(path).json())
  } catch (err) {
    throw new Error(`failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<DisksPackageHints | null>}
 */
export async function loadDisksPackageHints(env = process.env) {
  const disks = await loadDisksJson(env)
  return disks ? disksPackageHints(disks) : null
}
