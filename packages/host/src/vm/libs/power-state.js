/**
 * Lightweight VM power probe for `qctl vm ps` (not the verbose `vm status` dump).
 */

import { domainState } from './libvirt/index.js'
import { createProxmoxClient } from './proxmox/client.js'
import { loadProxmoxConfig } from './proxmox/config.js'

/** @import { VmArgv, VmDriver } from '../types.js' */

/**
 * @typedef {'running' | 'stopped' | 'absent'} VmPowerKind
 */

/**
 * @typedef {object} VmPowerState
 * @property {VmPowerKind} kind
 * @property {string} [detail]  raw hypervisor state (e.g. libvirt "paused")
 */

/**
 * @param {VmDriver} driver
 * @param {VmArgv} argv  profile/name already resolved by {@link loadDriver}
 * @returns {Promise<VmPowerState>}
 */
export async function resolveVmPowerState(driver, argv) {
  if (driver.id === 'proxmox') {
    if (argv.dryRun) return { kind: 'absent', detail: 'dry-run' }
    const client = await createProxmoxClient(
      await loadProxmoxConfig({
        env: argv.env || 'dev',
        profile: /** @type {string} */ (argv.profile),
      }),
    )
    const vmid = await client.findVmidByName(argv.name)
    if (vmid == null) return { kind: 'absent' }
    const st = await client.qemuStatus(vmid)
    const raw = String(st?.status || '').trim() || '?'
    if (raw === 'running') return { kind: 'running', detail: raw }
    return { kind: 'stopped', detail: raw }
  }

  const state = await domainState(argv.connect, argv.name)
  if (state == null) return { kind: 'absent' }
  if (state === 'running') return { kind: 'running', detail: state }
  return { kind: 'stopped', detail: state }
}
