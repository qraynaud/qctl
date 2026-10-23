import * as libvirt from './libvirt/index.js'
import { resolveVmPowerState } from './power-state.js'
import * as clientMod from './proxmox/client.js'
import * as configMod from './proxmox/config.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv, VmDriver } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  libvirt.domainState.mockRestore?.()
  // @ts-expect-error restore
  configMod.loadProxmoxConfig.mockRestore?.()
  // @ts-expect-error restore
  clientMod.createProxmoxClient.mockRestore?.()
})

describe('resolveVmPowerState', () => {
  test('workstation: maps domainState', async () => {
    const driver = /** @type {VmDriver} */ (/** @type {never} */ ({ id: 'workstation' }))
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({ connect: 'qemu:///session', name: 'rocky' })
    )
    spyOn(libvirt, 'domainState').mockResolvedValueOnce(null)
    expect(await resolveVmPowerState(driver, argv)).toEqual({ kind: 'absent' })

    spyOn(libvirt, 'domainState').mockResolvedValueOnce('running')
    expect(await resolveVmPowerState(driver, argv)).toEqual({
      kind: 'running',
      detail: 'running',
    })

    spyOn(libvirt, 'domainState').mockResolvedValueOnce('shut off')
    expect(await resolveVmPowerState(driver, argv)).toEqual({
      kind: 'stopped',
      detail: 'shut off',
    })
  })

  test('proxmox: maps qemu status', async () => {
    const driver = /** @type {VmDriver} */ (/** @type {never} */ ({ id: 'proxmox' }))
    const argv = /** @type {VmArgv} */ (
      /** @type {never} */ ({ env: 'dev', profile: 'pve', name: 'rocky' })
    )
    spyOn(configMod, 'loadProxmoxConfig').mockResolvedValue(/** @type {never} */ ({}))
    spyOn(clientMod, 'createProxmoxClient').mockResolvedValue(
      /** @type {never} */ ({
        findVmidByName: async () => 100,
        qemuStatus: async () => ({ status: 'running' }),
      }),
    )
    expect(await resolveVmPowerState(driver, argv)).toEqual({
      kind: 'running',
      detail: 'running',
    })
  })
})
