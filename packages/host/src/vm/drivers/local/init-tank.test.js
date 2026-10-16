import * as options from '../../../lib/options.js'
import * as resolveDisks from '../../libs/resolve-provision-disks.js'
import { initTank } from './init-tank.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

const resolvedWithTank = {
  os: { id: 'os', size: '20G' },
  data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
  tanks: {
    tank: {
      id: 'tank',
      mount: '/tank',
      options: {
        pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
        dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
        acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
      },
      vdevs: {
        data0: {
          role: /** @type {const} */ ('data'),
          type: /** @type {const} */ ('single'),
          members: { 'rocky-data0': { id: 'rocky-data0', size: '2G' } },
        },
      },
    },
  },
  members: [
    { id: 'os', kind: /** @type {const} */ ('os'), size: '20G' },
    { id: 'vw', kind: /** @type {const} */ ('data'), size: '2G', owner: 'vw' },
    {
      id: 'rocky-data0',
      kind: /** @type {const} */ ('tank'),
      size: '2G',
      owner: 'tank',
      role: /** @type {const} */ ('data'),
    },
  ],
  encryptedTankIds: ['tank'],
}

const resolvedNoTanks = {
  os: { id: 'os', size: '20G' },
  data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
  tanks: {},
  members: [
    { id: 'os', kind: /** @type {const} */ ('os'), size: '20G' },
    { id: 'vw', kind: /** @type {const} */ ('data'), size: '2G', owner: 'vw' },
  ],
  encryptedTankIds: [],
}

afterEach(() => {
  // @ts-expect-error restore
  options.portsFromArgv.mockRestore?.()
  // @ts-expect-error restore
  resolveDisks.resolveProvisionDisks.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('local initTank', () => {
  test('dry-run prints plan and returns', async () => {
    spyOn(options, 'portsFromArgv').mockReturnValue({
      ssh: { port: 22, forward: 2222 },
      cockpit: { port: 9090, forward: 9090 },
    })
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(resolvedWithTank)
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await initTank(
      /** @type {VmArgv} */ ({
        name: 'rocky',
        connect: 'qemu:///system',
        memory: 4096,
        vcpus: 2,
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
    expect(joined).toMatch(/seed --seed-profile init-tank/)
    expect(joined).toMatch(/pools=tank/)
    expect(joined).toMatch(/disposable boot/)
    expect(joined).not.toMatch(/wipe OS/)
  })

  test('no tanks warns and exits 0', async () => {
    spyOn(options, 'portsFromArgv').mockReturnValue({
      ssh: { port: 22 },
      cockpit: { port: 9090 },
    })
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(resolvedNoTanks)
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await initTank(
      /** @type {VmArgv} */ ({
        name: 'rocky',
        connect: 'qemu:///system',
        memory: 4096,
        vcpus: 2,
        network: 'user',
        osinfo: 'rocky9',
        timeout: 60,
        dryRun: false,
        forceDownload: false,
        noConsole: true,
        env: 'dev',
      }),
    )
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/no disks\.tanks/)
  })
})
