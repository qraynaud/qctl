import { check } from './workstation/check.js'
import { destroy } from './workstation/destroy.js'
import { down } from './workstation/down.js'
import { initTank } from './workstation/init-tank.js'
import { sshInfo } from './workstation/ssh-info.js'
import { status } from './workstation/status.js'
import { up } from './workstation/up.js'

/** @import { VmArgv, VmDriver } from '../types.js' */

/**
 * @param {VmArgv} [_argv]
 * @returns {VmDriver}
 */
export function createDriver(_argv) {
  return {
    id: 'workstation',
    check,
    up,
    down,
    destroy,
    status,
    initTank,
    sshInfo,
  }
}
