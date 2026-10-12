import { down } from './down.js'
import * as shared from './shared.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  shared.clientFrom.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox down', () => {
  test('dry-run logs and returns', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await down(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        dryRun: true,
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would ACPI shutdown/)
  })

  test('already stopped returns early', async () => {
    spyOn(shared, 'clientFrom').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof shared.clientFrom>>} */ (
        /** @type {never} */ ({
          findVmidByName: async () => 101,
          qemuStatus: async () => ({ status: 'stopped' }),
          config: { node: 'pve' },
        })
      ),
    )
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await down(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        dryRun: false,
        env: 'dev',
        timeout: 30,
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/already stopped/)
  })
})
