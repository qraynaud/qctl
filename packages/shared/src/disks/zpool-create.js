/**
 * Build `zpool create` argv from a guest disks.json tank entry.
 */
import { vdevRoleArgv, zfsAcltype } from './vdev-registry.js'

/** @import { DisksJson } from './disks-json-types.js' */

/**
 * @typedef {object} ResolvedTankVdev
 * @property {string} role
 * @property {string} type
 * @property {string[]} devices  absolute block device paths
 */

/**
 * @typedef {object} BuildZpoolCreateOpts
 * @property {string} pool
 * @property {string} mount
 * @property {DisksJson['tanks'][string]['options']} options
 * @property {ResolvedTankVdev[]} vdevs  data first, then special (caller order)
 * @property {{ keylocation: string } | null | undefined} [encryption]
 */

/**
 * @param {BuildZpoolCreateOpts} opts
 * @returns {string[]}
 */
export function buildZpoolCreateArgv(opts) {
  const { pool, mount, options, vdevs, encryption } = opts
  if (!vdevs.length) throw new Error(`tank ${pool}: no vdevs`)
  if (!vdevs.some((v) => v.role === 'data')) {
    throw new Error(`tank ${pool}: need at least one data vdev`)
  }

  /** @type {string[]} */
  const argv = ['zpool', 'create', '-f']

  for (const [key, value] of Object.entries(options.pool || {})) {
    argv.push('-o', `${key}=${value}`)
  }

  argv.push('-O', `mountpoint=${mount}`)
  for (const [key, value] of Object.entries(options.dataset || {})) {
    argv.push('-O', `${key}=${value}`)
  }
  for (const [key, value] of Object.entries(options.acl || {})) {
    const v = key === 'acltype' ? zfsAcltype(String(value)) : value
    argv.push('-O', `${key}=${v}`)
  }

  if (encryption?.keylocation) {
    argv.push(
      '-O',
      'encryption=aes-256-gcm',
      '-O',
      'keyformat=passphrase',
      '-O',
      `keylocation=${encryption.keylocation}`,
    )
  }

  argv.push(pool)

  const data = vdevs.filter((v) => v.role === 'data')
  const other = vdevs.filter((v) => v.role !== 'data')
  for (const v of [...data, ...other]) {
    argv.push(...vdevRoleArgv(v.role, v.type, v.devices))
  }
  return argv
}
