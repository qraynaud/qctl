import * as libvirt from '../libs/libvirt/index.js'
import * as proxmoxShared from './proxmox/shared.js'
import { module as proxmoxModule } from './proxmox.js'
import { _resetDriverRegistryForTests, getDriverModule, registerDriver } from './registry.js'
import { module as workstationModule } from './workstation.js'
import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext } from '../driver-contract.js' */

const THIN_OPS = [
  'find',
  'create',
  'start',
  'stop',
  'destroy',
  'reconcile',
  'detachSeed',
  'collectCheckFacts',
  'createFlagStore',
  'powerState',
  'resolveEndpoint',
  'provisionOverlaySchema',
  'getStatus',
  'defaultVmName',
]

beforeEach(() => {
  _resetDriverRegistryForTests()
  registerDriver(workstationModule)
  registerDriver(proxmoxModule)
})

/** @param {Partial<VmContext>} patch */
function ctx(patch = {}) {
  return /** @type {VmContext} */ ({
    env: 'dev',
    name: 'rocky',
    dryRun: false,
    timeout: 0,
    connect: 'qemu:///session',
    ...patch,
  })
}

describe('thin VmDriverModule ops', () => {
  test('workstation and proxmox modules expose the thin surface', () => {
    for (const mod of [workstationModule, proxmoxModule]) {
      const reg = getDriverModule(mod.id)
      expect(reg).toBeDefined()
      for (const key of THIN_OPS) {
        expect(
          reg?.[/** @type {keyof typeof reg} */ (key)],
          `${String(mod.id)}.${key}`,
        ).toBeDefined()
      }
    }
  })

  test('workstation find returns handle when domain exists', async () => {
    spyOn(libvirt, 'domainExists').mockResolvedValue(true)
    const handle = await workstationModule.find?.(ctx({ name: 'rocky-dev' }))
    expect(handle).toEqual({ connect: 'qemu:///session', name: 'rocky-dev' })
    // @ts-expect-error restore
    libvirt.domainExists.mockRestore?.()
  })

  test('workstation find returns null when absent', async () => {
    spyOn(libvirt, 'domainExists').mockResolvedValue(false)
    expect(await workstationModule.find?.(ctx())).toBeNull()
    // @ts-expect-error restore
    libvirt.domainExists.mockRestore?.()
  })

  test('proxmox find resolves vmid', async () => {
    const client = {
      findVmidByName: async (/** @type {string} */ name) => (name === 'rocky' ? 101 : null),
    }
    spyOn(proxmoxShared, 'clientFrom').mockResolvedValue(/** @type {never} */ (client))
    const handle = await proxmoxModule.find?.(ctx())
    expect(handle).toMatchObject({ vmid: 101, name: 'rocky' })
    // @ts-expect-error restore
    proxmoxShared.clientFrom.mockRestore?.()
  })

  test('provisionOverlaySchema parses empty overlays', () => {
    expect(workstationModule.provisionOverlaySchema?.safeParse({}).success).toBe(true)
    expect(proxmoxModule.provisionOverlaySchema?.safeParse({ storage: 'local' }).success).toBe(true)
  })

  test('modules do not expose fat CLI methods or wipeArtifacts', () => {
    for (const mod of [workstationModule, proxmoxModule]) {
      for (const key of ['up', 'down', 'initTank', 'sshInfo', 'check', 'status', 'wipeArtifacts']) {
        expect(mod[/** @type {keyof typeof mod} */ (key)]).toBeUndefined()
      }
    }
  })

  test('proxmox registers refineProvision; workstation does not need it', () => {
    expect(typeof proxmoxModule.refineProvision).toBe('function')
    expect(workstationModule.refineProvision).toBeUndefined()
  })
})
