import { INSTALLED, defineFlag } from '../libs/flags.js'
import * as libvirtFlagStore from '../libs/libvirt/flag-store.js'
import * as proxmoxFlagStore from '../libs/proxmox/flag-store.js'
import * as proxmoxShared from './proxmox/shared.js'
import { createFlagStore as createProxmoxFlags, module as proxmoxModule } from './proxmox.js'
import { _resetDriverRegistryForTests, getDriverModule, registerDriver } from './registry.js'
import {
  createFlagStore as createWorkstationFlags,
  module as workstationModule,
} from './workstation.js'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext, VmFlagStore } from '../driver-contract.js' */

beforeEach(() => {
  _resetDriverRegistryForTests()
  registerDriver(workstationModule)
  registerDriver(proxmoxModule)
})

afterEach(() => {
  // @ts-expect-error bun spy restore
  process.exit.mockRestore?.()
  // @ts-expect-error bun spy restore
  console.error.mockRestore?.()
  // @ts-expect-error bun spy restore
  proxmoxShared.clientFrom.mockRestore?.()
  // @ts-expect-error bun spy restore
  libvirtFlagStore.createFlagStore.mockRestore?.()
  // @ts-expect-error bun spy restore
  proxmoxFlagStore.createFlagStore.mockRestore?.()
})

/** @param {Partial<VmContext>} patch */
function ctx(patch) {
  return /** @type {VmContext} */ ({
    env: 'dev',
    name: 'rocky',
    dryRun: false,
    timeout: 0,
    ...patch,
  })
}

/** @returns {VmFlagStore} */
function fakeStore() {
  return /** @type {VmFlagStore} */ (
    /** @type {never} */ ({
      has: async () => false,
      get: async () => true,
      set: async () => {},
      delete: async () => {},
      entry: async () => ({ name: INSTALLED.name, schema: INSTALLED.schema, value: true }),
    })
  )
}

describe('module.createFlagStore', () => {
  test('drivers barrel re-exports defineFlag / INSTALLED', () => {
    expect(INSTALLED.name).toBe('installed')
    expect(defineFlag('demo', INSTALLED.schema).name).toBe('demo')
  })

  test('registry modules expose createFlagStore', () => {
    expect(typeof getDriverModule(workstationModule.id)?.createFlagStore).toBe('function')
    expect(typeof getDriverModule(proxmoxModule.id)?.createFlagStore).toBe('function')
  })

  test('workstation delegates to libvirt flag store with connect + name', async () => {
    const fake = fakeStore()
    const spy = spyOn(libvirtFlagStore, 'createFlagStore').mockReturnValue(
      /** @type {never} */ (fake),
    )
    const store = await createWorkstationFlags(
      ctx({ connect: 'qemu:///session', name: 'rocky-dev' }),
    )
    expect(spy).toHaveBeenCalledWith('qemu:///session', 'rocky-dev')
    expect(store).toBe(fake)
  })

  test('proxmox resolves vmid then delegates to PVE flag store', async () => {
    const client = {
      findVmidByName: async (/** @type {string} */ name) => (name === 'rocky-dev' ? 101 : null),
    }
    spyOn(proxmoxShared, 'clientFrom').mockResolvedValue(/** @type {never} */ (client))
    const fake = fakeStore()
    const spy = spyOn(proxmoxFlagStore, 'createFlagStore').mockReturnValue(
      /** @type {never} */ (fake),
    )

    const store = await createProxmoxFlags(ctx({ name: 'rocky-dev', profile: 'px' }))
    expect(spy).toHaveBeenCalledWith(client, 101)
    expect(store).toBe(fake)
  })

  test('proxmox dies when VM name is missing on the node', async () => {
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    spyOn(proxmoxShared, 'clientFrom').mockResolvedValue(
      /** @type {never} */ ({
        findVmidByName: async () => null,
      }),
    )
    await expect(createProxmoxFlags(ctx({ name: 'gone' }))).rejects.toThrow(/exit/)
  })
})
