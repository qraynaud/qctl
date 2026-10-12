/**
 * Hypervisor drivers: local (libvirt) and proxmox (PVE API).
 */
import { resolveBootResources } from '../../lib/options.js'
import { resolveVmName } from '../../lib/target.js'
import { die } from '../../lib/util.js'

/** @import { VmArgv, VmDriver } from '../types.js' */

/**
 * Resolve --name / memory / vcpus defaults, then load the driver for --target.
 * @param {VmArgv} argv
 * @returns {Promise<VmDriver>}
 */
export async function loadDriver(argv) {
  argv.name = resolveVmName(argv)
  resolveBootResources(argv)
  const target = argv.target || 'local'
  if (target === 'proxmox') {
    const { createDriver } = await import('./proxmox.js')
    return /** @type {VmDriver} */ (createDriver(argv))
  }
  if (target === 'local') {
    const { createDriver } = await import('./local.js')
    return /** @type {VmDriver} */ (createDriver(argv))
  }
  die(`unknown --target ${target}`)
}
