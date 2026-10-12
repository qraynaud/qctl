import * as options from '../../../lib/options.js'
import { initTank } from './init-tank.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  options.portsFromArgv.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('local initTank', () => {
  test('dry-run prints plan and returns', async () => {
    spyOn(options, 'portsFromArgv').mockReturnValue([])
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await initTank(
      /** @type {VmArgv} */ ({
        name: 'rocky',
        connect: 'qemu:///system',
        memory: 4096,
        vcpus: 2,
        vwSize: '10G',
        dataSize: '1G',
        specialSize: '1G',
        network: 'user',
        osinfo: 'rocky9',
        timeout: 60,
        dryRun: true,
        forceDownload: false,
        noConsole: true,
        env: 'dev',
      }),
    )
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/dry-run init-tank/)
    expect(joined).toMatch(/seed --profile init-tank/)
  })
})
