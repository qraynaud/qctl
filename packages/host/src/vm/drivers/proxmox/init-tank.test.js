import * as platformTooling from '../../../tooling/platform-tooling.js'
import * as seedRun from '../../libs/seed/run.js'
import { initTank } from './init-tank.js'
import * as shared from './shared.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  platformTooling.ensureCloudImage.mockRestore?.()
  // @ts-expect-error restore
  seedRun.runSeed.mockRestore?.()
  // @ts-expect-error restore
  shared.ping.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
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

  test('passes target=proxmox to runSeed', async () => {
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
          vwSize: '10G',
          dataSize: '1G',
          specialSize: '1G',
          timeout: 60,
          dryRun: false,
          forceDownload: false,
          noConsole: true,
        }),
      ),
    ).rejects.toThrow(/exit 1/)
    expect(seed).toHaveBeenCalled()
    expect(seed.mock.calls[0]?.[0]).toMatchObject({
      profile: 'init-tank',
      target: 'proxmox',
      env: 'dev',
    })
  })
})
