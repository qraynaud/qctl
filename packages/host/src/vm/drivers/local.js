import { check } from './local/check.js'
import { destroy } from './local/destroy.js'
import { down } from './local/down.js'
import { initTank } from './local/init-tank.js'
import { sshInfo } from './local/ssh-info.js'
import { status } from './local/status.js'
import { up } from './local/up.js'

/** @import { VmArgv, VmDriver } from '../types.js' */

/**
 * @param {VmArgv} [_argv]
 * @returns {VmDriver}
 */
export function createDriver(_argv) {
  return {
    id: 'local',
    check,
    up,
    down,
    destroy,
    status,
    initTank,
    sshInfo,
  }
}
