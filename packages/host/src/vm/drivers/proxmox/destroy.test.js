import * as diskHolder from '../../libs/proxmox/disk-holder.js'
import * as vm from '../../libs/proxmox/vm.js'
import { destroy } from './destroy.js'
import * as shared from './shared.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  shared.clientFrom.mockRestore?.()
  // @ts-expect-error restore
  vm.destroyRockyVm.mockRestore?.()
  // @ts-expect-error restore
  diskHolder.destroyHolder.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox destroy', () => {
  test('dry-run logs and returns', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await destroy(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        dryRun: true,
        keepData: false,
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would destroy Proxmox/)
  })

  test('destroys rocky vm when vmid found', async () => {
    const client = /** @type {Awaited<ReturnType<typeof shared.clientFrom>>} */ (
      /** @type {never} */ ({
        findVmidByName: async () => 101,
      })
    )
    spyOn(shared, 'clientFrom').mockResolvedValue(client)
    const destroyRocky = spyOn(vm, 'destroyRockyVm').mockResolvedValue({
      vw: null,
      data: [],
      special: [],
      vmid: 101,
    })
    await destroy(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        dryRun: false,
        keepData: true,
        env: 'dev',
      }),
    )
    expect(destroyRocky).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ vmid: 101, keep: 'persistent' }),
    )
  })
})
