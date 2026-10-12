import * as shared from './shared.js'
import { status } from './status.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  shared.clientFrom.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox status', () => {
  test('dry-run logs and returns', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await status(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        dryRun: true,
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would query Proxmox/)
  })

  test('prints status when VM found', async () => {
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
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await status(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        dryRun: false,
        env: 'dev',
      }),
    )
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/vmid=101/)
    expect(joined).toMatch(/running/)
  })
})
