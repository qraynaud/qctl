/**
 * Deployment target (local libvirt vs Proxmox) and env (dev vs prod).
 */
import { die } from './util.js'

/** @import { VmArgv, VmEnv, VmTarget } from '../types.js' */

export const TARGETS = /** @type {const} */ (['local', 'proxmox'])
export const ENVS = /** @type {const} */ (['dev', 'prod'])

/**
 * Default libvirt/Proxmox VM name when --name is omitted.
 * @param {{ target?: VmTarget | string, env?: VmEnv | string }} opts
 * @returns {string}
 */
export function defaultVmName({ target, env }) {
  if (target === 'proxmox') return env === 'prod' ? 'rocky' : `rocky-${env}`
  return 'rocky'
}

/**
 * Resolve name after yargs parse. Call from handlers (middleware order is fragile
 * with commandDir).
 * @param {VmArgv} argv
 * @returns {string}
 */
export function resolveVmName(argv) {
  const name =
    argv.name != null && String(argv.name).trim() !== '' ? String(argv.name).trim() : null
  return name || defaultVmName({ target: argv.target, env: argv.env })
}

/**
 * Prod on Proxmox must map physical / passthrough disks — not implemented yet.
 * Call before any Proxmox lifecycle that needs tank disks.
 * @param {{ target?: VmTarget | string, env?: VmEnv | string }} opts
 */
export function assertProxmoxDiskPlan({ target, env }) {
  if (target !== 'proxmox') return
  if (env === 'prod') {
    die(
      'TODO: Proxmox --env prod physical disk mapping '
        + '(passthrough / by-id for OS keep + /vw + 5 data + 2 special). '
        + 'Use --env dev for virtual disks on Proxmox, or --target local.',
    )
  }
}
