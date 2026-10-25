import * as shared from './shared.js'
import { getStatus } from './status.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext } from '../../driver-contract.js' */

afterEach(() => {
  // @ts-expect-error restore
  shared.clientFrom.mockRestore?.()
})

/** @param {Partial<VmContext>} patch */
function ctx(patch) {
  return /** @type {VmContext} */ ({
    name: 'rocky-dev',
    env: 'dev',
    timeout: 120,
    dryRun: false,
    ...patch,
  })
}

describe('proxmox getStatus', () => {
  test('dry-run returns summary without API', async () => {
    const snap = await getStatus(ctx({ dryRun: true }))
    expect(snap.summary).toMatch(/would query Proxmox/)
    expect(snap.hints?.title).toMatch(/Proxmox/)
  })

  test('returns fields when VM found', async () => {
    spyOn(shared, 'clientFrom').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof shared.clientFrom>>} */ (
        /** @type {never} */ ({
          config: { node: 'pve' },
          findVmidByName: async () => 101,
          qemuStatus: async () => ({
            status: 'running',
            uptime: 10,
            cpus: 2,
            maxmem: 4 * 1024 ** 3,
          }),
        })
      ),
    )
    const snap = await getStatus(ctx({}))
    expect(snap.summary).toMatch(/vmid=101/)
    expect(snap.fields?.status).toBe('running')
  })
})
