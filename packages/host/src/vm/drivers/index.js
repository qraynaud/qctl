/**
 * Hypervisor drivers: workstation (libvirt) and proxmox (PVE API).
 */
import { resolveBootResources } from '../../lib/options.js'
import { resolveProfileArgv } from '../../lib/profile-argv.js'
import { resolveVmName } from '../../lib/target.js'
import { die } from '../../lib/util.js'

/** @import { VmArgv, VmDriver } from '../types.js' */

/**
 * Resolve provision profile → env/target, then --name / memory / vcpus, then driver.
 * @param {VmArgv} argv
 * @returns {Promise<VmDriver>}
 */
export async function loadDriver(argv) {
  resolveProfileArgv(argv)
  argv.name = resolveVmName(argv)
  resolveBootResources(argv)
  const target = argv.target || 'workstation'
  if (target === 'proxmox') {
    const { createDriver } = await import('./proxmox.js')
    return /** @type {VmDriver} */ (createDriver(argv))
  }
  if (target === 'workstation') {
    const { createDriver } = await import('./workstation.js')
    return /** @type {VmDriver} */ (createDriver(argv))
  }
  die(`unknown target ${target}`)
}
