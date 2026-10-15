/**
 * Vdev role registry + type → zpool geometry.
 * Extend {@link VDEV_ROLE_REGISTRY} when adding roles (e.g. log, cache).
 */
import { DISK_VDEV_ROLES, DISK_VDEV_TYPES } from './constants.js'

/**
 * Role → zpool class token (`null` = top-level data vdev on create).
 * @typedef {{ zpoolClass: string | null }} VdevRoleSpec
 */

/**
 * @type {Readonly<Record<(typeof DISK_VDEV_ROLES)[number], VdevRoleSpec>>}
 */
export const VDEV_ROLE_REGISTRY = Object.freeze({
  data: Object.freeze({ zpoolClass: null }),
  special: Object.freeze({ zpoolClass: 'special' }),
})

/**
 * zpool geometry keyword for a vdev type (`single` → no keyword).
 * @param {string} type
 * @returns {string | null}
 */
export function vdevTypeGeometry(type) {
  const t = String(type || '').trim()
  if (!DISK_VDEV_TYPES.includes(/** @type {(typeof DISK_VDEV_TYPES)[number]} */ (t))) {
    throw new Error(`unknown vdev type ${JSON.stringify(type)}`)
  }
  if (t === 'single') return null
  return t
}

/**
 * Argv fragment for one vdev: optional geometry keyword + device paths.
 * @param {string} type
 * @param {string[]} devices
 * @returns {string[]}
 */
export function vdevGeometryArgv(type, devices) {
  if (!devices.length) throw new Error(`vdev type ${type} has no devices`)
  const geo = vdevTypeGeometry(type)
  return geo ? [geo, ...devices] : [...devices]
}

/**
 * Argv fragment for a role+type vdev (includes `special` class when needed).
 * @param {string} role
 * @param {string} type
 * @param {string[]} devices
 * @returns {string[]}
 */
export function vdevRoleArgv(role, type, devices) {
  const r = String(role || '').trim()
  if (!DISK_VDEV_ROLES.includes(/** @type {(typeof DISK_VDEV_ROLES)[number]} */ (r))) {
    throw new Error(`unknown vdev role ${JSON.stringify(role)}`)
  }
  const spec = VDEV_ROLE_REGISTRY[/** @type {(typeof DISK_VDEV_ROLES)[number]} */ (r)]
  const body = vdevGeometryArgv(type, devices)
  return spec.zpoolClass ? [spec.zpoolClass, ...body] : body
}

/**
 * Map provision/disks.json acltype to a ZFS property value.
 * @param {string} acltype
 * @returns {string}
 */
export function zfsAcltype(acltype) {
  const v = String(acltype || '').trim()
  if (v === 'posix') return 'posixacl'
  return v
}
