/**
 * Guest `disks.json` (seed inject) — resolved topology without tank passphrases.
 * Passphrases stay in Tier-0 only (`tank_passphrase_<poolId>`).
 */
import { z } from 'zod'

import { DISK_VDEV_ROLES, DISK_VDEV_TYPES } from './constants.js'
import { tankOptionsSchema } from './tank-options.js'

/** @import { DisksJson, DisksPackageHints } from './disks-json-types.js' */

const idSchema = z.string().trim().min(1)
const sizeSchema = z.string().trim().min(1)

export const disksJsonOsSchema = z.strictObject({
  id: idSchema,
  size: sizeSchema.optional(),
})

export const disksJsonDataVolumeSchema = z.strictObject({
  id: idSchema,
  mount: z.string().trim().min(1),
  fs: z.string().trim().min(1),
  size: sizeSchema.optional(),
})

export const disksJsonTankMemberSchema = z.strictObject({
  id: idSchema,
  size: sizeSchema.optional(),
})

export const disksJsonVdevSchema = z.strictObject({
  role: z.enum(DISK_VDEV_ROLES),
  type: z.enum(DISK_VDEV_TYPES),
  members: z.record(idSchema, disksJsonTankMemberSchema),
})

/** Tank entry as written to disks.json (no passphrase). */
export const disksJsonTankSchema = z.strictObject({
  id: idSchema,
  mount: z.string().trim().min(1),
  options: tankOptionsSchema,
  vdevs: z.record(idSchema, disksJsonVdevSchema),
})

export const disksJsonMemberSchema = z.strictObject({
  id: idSchema,
  size: sizeSchema.optional(),
  kind: z.enum(['os', 'data', 'tank']),
  owner: idSchema.optional(),
  role: z.enum(DISK_VDEV_ROLES).optional(),
})

/**
 * Canonical guest disks.json document.
 */
export const disksJsonSchema = z.strictObject({
  os: disksJsonOsSchema,
  data: z.record(idSchema, disksJsonDataVolumeSchema),
  tanks: z.record(idSchema, disksJsonTankSchema),
  members: z.array(disksJsonMemberSchema),
  encryptedTankIds: z.array(idSchema),
})

/**
 * Package-capability hints from a parsed disks.json document.
 * @param {DisksJson} disks
 * @returns {DisksPackageHints}
 */
export function disksPackageHints(disks) {
  /** @type {Set<string>} */
  const filesystems = new Set()
  for (const vol of Object.values(disks.data)) {
    if (vol.fs) filesystems.add(vol.fs)
  }
  return {
    filesystems: [...filesystems].sort(),
    hasTanks: Object.keys(disks.tanks).length > 0,
  }
}
