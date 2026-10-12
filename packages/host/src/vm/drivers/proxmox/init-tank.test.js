import * as platformTooling from '../../../tooling/platform-tooling.js'
import { initTank } from './init-tank.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  platformTooling.ensureCloudImage.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox initTank', () => {
  test('dry-run prints plan and returns', async () => {
    spyOn(platformTooling, 'ensureCloudImage').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof platformTooling.ensureCloudImage>>} */ ({
        file: 'rocky.qcow2',
      }),
    )
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await initTank(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        target: 'proxmox',
        env: 'dev',
        memory: 4096,
        vcpus: 2,
        vwSize: '10G',
        dataSize: '1G',
        specialSize: '1G',
        timeout: 60,
        dryRun: true,
        forceDownload: false,
        noConsole: true,
      }),
    )
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/dry-run Proxmox init-tank/)
    expect(joined).toMatch(/seed --profile init-tank/)
  })
})
