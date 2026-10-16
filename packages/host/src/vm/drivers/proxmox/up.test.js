import * as resolveDisks from '../../libs/resolve-provision-disks.js'
import * as seedRun from '../../libs/seed/run.js'
import * as pipeline from '../../libs/up-pipeline.js'
import * as shared from './shared.js'
import { up } from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmUpBackend } from '../../libs/up-pipeline.js' */
/** @import { VmArgv } from '../../types.js' */

const sampleResolved = {
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
  pipeline.runVmUp.mockRestore?.()
  // @ts-expect-error restore
  seedRun.runSeed.mockRestore?.()
  // @ts-expect-error restore
  shared.ping.mockRestore?.()
  // @ts-expect-error restore
  resolveDisks.resolveProvisionDisks.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
})

describe('proxmox up', () => {
  test('delegates to runVmUp with a backend', async () => {
    const run = spyOn(pipeline, 'runVmUp').mockResolvedValue(undefined)
    const argv = /** @type {VmArgv} */ ({
      name: 'rocky-dev',
      target: 'proxmox',
      env: 'dev',
      dryRun: true,
    })
    await up(argv)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toBe(argv)
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      dryRun: expect.any(Function),
      findRunnableExisting: expect.any(Function),
      createFirstBoot: expect.any(Function),
    })
  })

  test('createFirstBoot passes target=proxmox to runSeed', async () => {
    const bag = {
      /** @type {VmUpBackend<string, string>['createFirstBoot'] | null} */
      createFirstBoot: null,
    }
    spyOn(pipeline, 'runVmUp').mockImplementation(async (_argv, b) => {
      bag.createFirstBoot = /** @type {NonNullable<(typeof bag)['createFirstBoot']>} */ (
        /** @type {never} */ (b.createFirstBoot)
      )
    })
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
      isoPath: '/tmp/qctl-missing-appliance.iso',
      imgPath: '/tmp/qctl-missing-appliance.img',
      profile: 'appliance',
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

    await up(
      /** @type {VmArgv} */ ({
        name: 'rocky-dev',
        target: 'proxmox',
        env: 'dev',
        dryRun: false,
      }),
    )
    expect(bag.createFirstBoot).toBeTypeOf('function')
    await expect(
      /** @type {NonNullable<(typeof bag)['createFirstBoot']>} */ (bag.createFirstBoot)(
        /** @type {VmArgv} */ ({
          name: 'rocky-dev',
          target: 'proxmox',
          env: 'dev',
          wipeOs: false,
          forceDownload: false,
        }),
        new AbortController().signal,
        { wantSerial: false },
      ),
    ).rejects.toThrow(/exit 1|ISO missing|not found/)
    expect(seed).toHaveBeenCalled()
    expect(seed.mock.calls[0]?.[0]).toMatchObject({
      profile: 'appliance',
      target: 'proxmox',
      env: 'dev',
    })
  })
})
