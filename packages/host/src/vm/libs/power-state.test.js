import * as proxmoxShared from '../drivers/proxmox/shared.js'
import * as libvirt from './libvirt/index.js'
import { resolveVmPowerState } from './power-state.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  libvirt.domainState.mockRestore?.()
  // @ts-expect-error restore
  proxmoxShared.clientFrom.mockRestore?.()
})

/** @param {Partial<VmArgv>} patch */
function argv(patch) {
  return /** @type {VmArgv} */ (
    /** @type {never} */ ({
      ...patch,
    })
  )
}

describe('resolveVmPowerState', () => {
  test('workstation: maps domainState via module.powerState', async () => {
    const driver = { id: 'workstation' }
    const a = argv({ connect: 'qemu:///session', name: 'rocky' })
    spyOn(libvirt, 'domainState').mockResolvedValueOnce(null)
    expect(await resolveVmPowerState(driver, a)).toEqual({ kind: 'absent' })

    spyOn(libvirt, 'domainState').mockResolvedValueOnce('running')
    expect(await resolveVmPowerState(driver, a)).toEqual({
      kind: 'running',
      detail: 'running',
    })

    spyOn(libvirt, 'domainState').mockResolvedValueOnce('shut off')
    expect(await resolveVmPowerState(driver, a)).toEqual({
      kind: 'stopped',
      detail: 'shut off',
    })
  })

  test('proxmox: maps qemu status via module.powerState', async () => {
    const driver = { id: 'proxmox' }
    const a = argv({ env: 'dev', profile: 'pve', name: 'rocky' })
    spyOn(proxmoxShared, 'clientFrom').mockResolvedValue(
      /** @type {never} */ ({
        findVmidByName: async () => 100,
        qemuStatus: async () => ({ status: 'running' }),
      }),
    )
    expect(await resolveVmPowerState(driver, a)).toEqual({
      kind: 'running',
      detail: 'running',
    })
  })
})
