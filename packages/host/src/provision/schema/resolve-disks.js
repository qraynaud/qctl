/**
 * Resolve provision `disks:` + platform defaults → canonical topology for
 * host attach, seed/Tier-0, and guest stages.
 */
import { assertDisksDataFilesystems } from './disks.js'

/** @import { z } from 'zod' */
/** @import { disksSchema } from './disks.js' */

/**
 * @typedef {object} ResolveDisksPlatform
 * @property {readonly string[]} filesystems
 * @property {string} defaultFs
 * @property {{ id?: string, size?: string }} osDisk
 */

/**
 * @typedef {object} ResolvedOsDisk
 * @property {string} id
 * @property {string} [size]
 */

/**
 * @typedef {object} ResolvedDataVolume
 * @property {string} id
 * @property {string} mount
 * @property {string} fs
 * @property {string} [size]
 */

/**
 * @typedef {object} ResolvedTankMember
 * @property {string} id
 * @property {string} [size]
 */

/**
 * @typedef {object} ResolvedVdev
 * @property {'data' | 'special'} role
 * @property {'single' | 'mirror' | 'raidz' | 'raidz2' | 'raidz3'} type
 * @property {Record<string, ResolvedTankMember>} members
 */

/**
 * @typedef {object} ResolvedTank
 * @property {string} id
 * @property {string} mount
 * @property {string | Buffer} [passphrase]
 * @property {{
 *   pool: { ashift: number, autotrim: string, autoexpand: string, failmode: string },
 *   dataset: { compression: string, atime: string, xattr: string, special_small_blocks: number },
 *   acl: { acltype: string, aclmode: string, aclinherit: string },
 * }} options
 * @property {Record<string, ResolvedVdev>} vdevs
 */

/**
 * Flat disk for host attach (os + data volumes + tank members).
 * @typedef {object} ResolvedDiskMember
 * @property {string} id
 * @property {string} [size]
 * @property {'os' | 'data' | 'tank'} kind
 * @property {string} [owner] data map key or tank pool id
 * @property {'data' | 'special'} [role] tank vdev role when kind is tank
 */

/**
 * @typedef {object} ResolvedDisks
 * @property {ResolvedOsDisk} os
 * @property {Record<string, ResolvedDataVolume>} data
 * @property {Record<string, ResolvedTank>} tanks
 * @property {ResolvedDiskMember[]} members
 * @property {string[]} encryptedTankIds pool ids with a passphrase
 */

/**
 * @param {{ id?: string, size?: string }} osDisk
 * @returns {ResolvedOsDisk}
 */
function resolveOsFromPlatform(osDisk) {
  const id = osDisk.id?.trim() || 'os'
  return osDisk.size ? { id, size: osDisk.size } : { id }
}

/**
 * Apply platform defaults and emit canonical disks + member index.
 *
 * - Omitting `disks` / `disks.os` → {@link ResolveDisksPlatform.osDisk}
 * - Omitting `disks.data.*.fs` → `defaultFs` (must be ∈ `filesystems`)
 * - Tank options / map ids already applied by the provision schema
 *
 * Does not require data|tanks (schema already enforces that when `disks:` is present).
 *
 * @param {z.infer<typeof disksSchema> | undefined} disks
 *   Parsed {@link disksSchema} output (`undefined` if omitted).
 * @param {ResolveDisksPlatform} platform
 * @returns {ResolvedDisks}
 */
export function resolveDisks(disks, platform) {
  const { filesystems, defaultFs, osDisk } = platform
  if (!filesystems?.length) throw new Error('resolveDisks: platform.filesystems is required')
  if (!defaultFs || !filesystems.includes(defaultFs)) {
    throw new Error(
      `resolveDisks: platform.defaultFs ${JSON.stringify(defaultFs)} must be in filesystems`,
    )
  }
  if (!osDisk || typeof osDisk !== 'object') {
    throw new Error('resolveDisks: platform.osDisk is required')
  }

  assertDisksDataFilesystems(disks, filesystems)

  /** @type {ResolvedOsDisk} */
  const os = disks?.os
    ? disks.os.size
      ? { id: disks.os.id, size: disks.os.size }
      : { id: disks.os.id }
    : resolveOsFromPlatform(osDisk)

  /** @type {Record<string, ResolvedDataVolume>} */
  const data = {}
  for (const [key, vol] of Object.entries(disks?.data || {})) {
    const fs = vol.fs || defaultFs
    if (!filesystems.includes(fs)) {
      throw new Error(
        `disks.data.${key}.fs ${JSON.stringify(fs)} is not in platform FILESYSTEMS `
          + `(${[...filesystems].join(', ')})`,
      )
    }
    data[key] = {
      id: vol.id,
      mount: vol.mount,
      fs,
      ...(vol.size ? { size: vol.size } : {}),
    }
  }

  /** @type {Record<string, ResolvedTank>} */
  const tanks = {}
  /** @type {string[]} */
  const encryptedTankIds = []
  for (const [key, tank] of Object.entries(disks?.tanks || {})) {
    tanks[key] = {
      id: tank.id,
      mount: tank.mount,
      options: tank.options,
      vdevs: tank.vdevs,
      ...(tank.passphrase ? { passphrase: tank.passphrase } : {}),
    }
    if (tank.passphrase) encryptedTankIds.push(tank.id)
  }

  /** @type {ResolvedDiskMember[]} */
  const members = [{ id: os.id, kind: 'os', ...(os.size ? { size: os.size } : {}) }]

  for (const [key, vol] of Object.entries(data)) {
    members.push({
      id: vol.id,
      kind: 'data',
      owner: key,
      ...(vol.size ? { size: vol.size } : {}),
    })
  }

  for (const tank of Object.values(tanks)) {
    for (const vdev of Object.values(tank.vdevs)) {
      for (const mem of Object.values(vdev.members)) {
        members.push({
          id: mem.id,
          kind: 'tank',
          owner: tank.id,
          role: vdev.role,
          ...(mem.size ? { size: mem.size } : {}),
        })
      }
    }
  }

  return { os, data, tanks, members, encryptedTankIds }
}
