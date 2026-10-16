/**
 * Shared disk / ZFS vdev vocabulary (provision + guest disks.json).
 */

export const DISK_VDEV_ROLES = Object.freeze(/** @type {const} */ (['data', 'special']))
export const DISK_VDEV_TYPES = Object.freeze(
  /** @type {const} */ (['single', 'mirror', 'raidz', 'raidz2', 'raidz3']),
)

/** Minimum member count per vdev type. */
export const DISK_VDEV_MIN_MEMBERS = Object.freeze(
  /** @type {const} */ ({
    single: 1,
    mirror: 2,
    raidz: 2,
    raidz2: 3,
    raidz3: 4,
  }),
)

/** TrueNAS SCALE–aligned defaults; aclmode is deliberately `passthrough` (not `discard`). */
export const DEFAULT_TANK_OPTIONS = Object.freeze({
  pool: Object.freeze({
    ashift: 12,
    autotrim: 'off',
    autoexpand: 'on',
    failmode: 'continue',
  }),
  dataset: Object.freeze({
    compression: 'lz4',
    atime: 'off',
    xattr: 'sa',
    special_small_blocks: 0,
  }),
  acl: Object.freeze({
    acltype: 'posix',
    aclmode: 'passthrough',
    aclinherit: 'passthrough',
  }),
})
