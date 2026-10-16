/**
 * Provision `disks:` topology (os / data / tanks).
 * Id defaults: os → `"os"`; map entries → map key. Options get TrueNAS-ish defaults.
 * Structural rules (≥1 data|tank, uniqueness, geometry, ≥1 data vdev) live here;
 * platform FS allow-list + env warnings:
 * {@link assertDisksDataFilesystems}, {@link collectDisksWarnings}.
 */
import { z } from 'zod'

import {
  DEFAULT_TANK_OPTIONS,
  DISK_VDEV_MIN_MEMBERS,
  DISK_VDEV_ROLES,
  DISK_VDEV_TYPES,
  tankOptionsSchema,
} from '@qctl/shared'

import { mapWithIdDefault, optionalTrimmedId, optionalTrimmedText } from './zod-utils.js'

export {
  DEFAULT_TANK_OPTIONS,
  DISK_VDEV_MIN_MEMBERS,
  DISK_VDEV_ROLES,
  DISK_VDEV_TYPES,
  tankOptionsSchema,
}

const sizeSchema = z.string().trim().min(1)
const mapKey = z.string().trim().min(1)

/**
 * Mount paths claimed while parsing `disks:` (uniqueness across data + tanks).
 *
 * Intentionally process-lifetime — do **not** clear in production parse/schema code.
 * CLI loads provision once per process; clearing mid-parse would defeat uniqueness.
 *
 * Tests: `tooling/test-preload.js` clears this in a global `afterEach` (via bunfig
 * `[test].preload`). Still `diskMounts.clear()` between multiple parses inside one
 * test case.
 *
 * @type {Set<string>}
 */
export const diskMounts = new Set()

/** Required mount path; unique across data volumes + tanks. */
const uniqueMount = z
  .string()
  .trim()
  .min(1)
  .refine(
    (m) => {
      if (diskMounts.has(m)) return false
      diskMounts.add(m)
      return true
    },
    { message: 'duplicate mount' },
  )

export const disksOsSchema = z
  .strictObject({
    id: optionalTrimmedId.default('os'),
    size: sizeSchema.optional(),
  })
  .optional()

const disksDataVolumeSchema = z.strictObject({
  id: optionalTrimmedId,
  mount: uniqueMount,
  fs: z.string().trim().min(1).optional(),
  size: sizeSchema.optional(),
})

export const disksDataSchema = mapWithIdDefault(disksDataVolumeSchema, mapKey).optional()

const disksMemberInSchema = z.strictObject({
  id: optionalTrimmedId,
  size: sizeSchema.optional(),
})

export const disksVdevSchema = z
  .strictObject({
    role: z.enum(DISK_VDEV_ROLES),
    type: z.enum(DISK_VDEV_TYPES),
    members: mapWithIdDefault(disksMemberInSchema, mapKey),
  })
  .refine((vdev) => Object.keys(vdev.members).length >= DISK_VDEV_MIN_MEMBERS[vdev.type], {
    message: 'vdev type needs enough members (single≥1, mirror/raidz≥2, raidz2≥3, raidz3≥4)',
  })

export const disksTankSchema = z
  .strictObject({
    id: optionalTrimmedId,
    mount: uniqueMount,
    passphrase: optionalTrimmedText,
    options: tankOptionsSchema,
    vdevs: z.record(mapKey, disksVdevSchema),
  })
  .refine((tank) => Object.values(tank.vdevs).some((v) => v.role === 'data'), {
    message: 'tank needs at least one vdev with role: data',
  })

export const disksTanksSchema = mapWithIdDefault(disksTankSchema, mapKey).optional()

const disksBodySchema = z
  .strictObject({
    os: disksOsSchema,
    data: disksDataSchema,
    tanks: disksTanksSchema,
  })
  .refine(
    (disks) =>
      Object.keys(disks.data || {}).length > 0 || Object.keys(disks.tanks || {}).length > 0,
    { message: 'disks must include at least one data volume or tank' },
  )
  .superRefine((disks, ctx) => {
    /** @type {Map<string, string>} */
    const ids = new Map()

    /**
     * @param {string} id
     * @param {(string | number)[]} path
     */
    function claimId(id, path) {
      const prev = ids.get(id)
      if (prev) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate disk id ${JSON.stringify(id)} (also at ${prev})`,
          path,
        })
        return
      }
      ids.set(id, path.join('.'))
    }

    if (disks.os) claimId(disks.os.id, ['os', 'id'])

    for (const [key, vol] of Object.entries(disks.data || {})) {
      claimId(vol.id, ['data', key, 'id'])
    }

    for (const [tankKey, tank] of Object.entries(disks.tanks || {})) {
      for (const [vdevKey, vdev] of Object.entries(tank.vdevs)) {
        for (const [memKey, mem] of Object.entries(vdev.members)) {
          claimId(mem.id, ['tanks', tankKey, 'vdevs', vdevKey, 'members', memKey, 'id'])
        }
      }
    }
  })

/**
 * Full `disks:` block. Omit → platform OS default at resolve (no topology yet).
 * Present → must include ≥1 data volume or tank; os id defaults to `"os"`.
 */
export const disksSchema = disksBodySchema.optional()

/**
 * Soft warnings (type=single; prod data-only). Does not throw.
 * @param {z.infer<typeof disksSchema>} disks
 * @param {{ env?: string }} [opts]
 * @returns {string[]}
 */
export function collectDisksWarnings(disks, opts = {}) {
  /** @type {string[]} */
  const out = []
  if (!disks) return out

  for (const [tankKey, tank] of Object.entries(disks.tanks || {})) {
    for (const [vdevKey, vdev] of Object.entries(tank.vdevs)) {
      if (vdev.type === 'single') {
        out.push(`disks.tanks.${tankKey}.vdevs.${vdevKey}: type single has no redundancy`)
      }
    }
  }

  const hasData = Object.keys(disks.data || {}).length > 0
  const hasTanks = Object.keys(disks.tanks || {}).length > 0
  if (opts.env === 'prod' && hasData && !hasTanks) {
    out.push('disks: --env prod with data volumes and no tanks (hardware RAID expected?)')
  }
  return out
}

/**
 * Fail when an explicit `disks.data.*.fs` is outside the platform allow-list.
 * Omitted `fs` is fine (resolve fills the platform default later).
 * @param {z.infer<typeof disksSchema>} disks
 * @param {readonly string[]} filesystems
 */
export function assertDisksDataFilesystems(disks, filesystems) {
  if (!disks?.data) return
  const allowed = new Set(filesystems)
  for (const [key, vol] of Object.entries(disks.data)) {
    if (!vol.fs) continue
    if (!allowed.has(vol.fs)) {
      throw new Error(
        `disks.data.${key}.fs ${JSON.stringify(vol.fs)} is not in platform FILESYSTEMS `
          + `(${[...allowed].join(', ')})`,
      )
    }
  }
}
