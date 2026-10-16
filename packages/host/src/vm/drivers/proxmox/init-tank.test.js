import * as platformTooling from '../../../tooling/platform-tooling.js'
import * as resolveDisks from '../../libs/resolve-provision-disks.js'
import * as seedRun from '../../libs/seed/run.js'
import { initTank } from './init-tank.js'
import * as shared from './shared.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

const sampleResolved = {
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

afterEach(() => {
  // @ts-expect-error restore
  platformTooling.ensureCloudImage.mockRestore?.()
  // @ts-expect-error restore
  seedRun.runSeed.mockRestore?.()
  // @ts-expect-error restore
  shared.ping.mockRestore?.()
  // @ts-expect-error restore
  resolveDisks.resolveProvisionDisks.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox initTank', () => {
  test('dry-run prints plan and returns', async () => {
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(sampleResolved)
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
        timeout: 60,
        dryRun: true,
        forceDownload: false,
        noConsole: true,
      }),
    )
    const joined = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/dry-run Proxmox init-tank/)
    expect(joined).toMatch(/seed --seed-profile init-tank/)
    expect(joined).toMatch(/pools=tank/)
    expect(joined).toMatch(/disposable boot/)
  })

  test('passes target=proxmox to runSeed', async () => {
    spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(sampleResolved)
    spyOn(shared, 'ping').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof shared.ping>>} */ (
        /** @type {never} */ ({
          config: { node: 'pve' },
          findVmidByName: async () => null,
        })
      ),
    )
    const seed = spyOn(seedRun, 'runSeed').mockResolvedValue({
      isoPath: '/tmp/qctl-missing-init-tank.iso',
      imgPath: '/tmp/qctl-missing-init-tank.img',
      profile: 'init-tank',
      env: 'dev',
      instanceId: 'rocky-dev',
      keepDir: null,
    })
    spyOn(process, 'exit').mockImplementation(
      /** @param {number} [code] */
      (code) => {
        throw new Error(`exit ${code}`)
      },
    )
    spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      initTank(
        /** @type {VmArgv} */ ({
          name: 'rocky-dev',
          target: 'proxmox',
          env: 'dev',
          memory: 4096,
          vcpus: 2,
          timeout: 60,
          dryRun: false,
          forceDownload: false,
          noConsole: true,
        }),
      ),
    ).rejects.toThrow()
    expect(seed.mock.calls[0]?.[0]).toMatchObject({
      seedProfile: 'init-tank',
      target: 'proxmox',
      initTankPools: ['tank'],
    })
  })
})
