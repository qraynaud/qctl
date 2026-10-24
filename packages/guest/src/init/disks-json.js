/**
 * Guest loader for disks layout from ISO seed config.
 * Schema + package hints live in `@qctl/shared`.
 */
import { disksJsonSchema, disksPackageHints } from '@qctl/shared'

/** @import { DisksJson, DisksPackageHints } from '@qctl/shared' */

export { disksPackageHints }

/**
 * @param {DisksJson | undefined} disks
 * @returns {DisksJson | null}
 */
export function resolveDisks(disks) {
  if (!disks) return null
  return disksJsonSchema.parse(disks)
}

/**
 * @param {DisksJson | undefined} disks
 * @returns {DisksPackageHints | null}
 */
export function disksPackageHintsFrom(disks) {
  const parsed = resolveDisks(disks)
  return parsed ? disksPackageHints(parsed) : null
}
