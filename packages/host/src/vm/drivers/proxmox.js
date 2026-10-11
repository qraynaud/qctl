/** @import { VmArgv, VmDriver } from '../types.js' */

/**
 * Proxmox VE driver — PVE JSON API.
 * Dev: virtual disks (create TODO). Prod: physical disk mapping (TODO).
 */
import { check } from './proxmox/check.js'
import { destroy } from './proxmox/destroy.js'
import { down } from './proxmox/down.js'
import { initTank } from './proxmox/init-tank.js'
import { sshInfo } from './proxmox/ssh-info.js'
import { status } from './proxmox/status.js'
import { up } from './proxmox/up.js'

/**
 * @param {VmArgv} [_argv]
 * @returns {VmDriver}
 */
export function createDriver(_argv) {
  return {
    id: 'proxmox',
    check,
    up,
    down,
    destroy,
    status,
    initTank,
    sshInfo,
  }
}
