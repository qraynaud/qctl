import * as zx from 'zx'

import * as util from '../../../lib/util.js'
import * as download from '../../commands/download.js'
import * as disks from '../../libs/disks.js'
import * as lifecycle from '../../libs/installed-lifecycle.js'
import * as libvirt from '../../libs/libvirt/index.js'
import * as resolveDisks from '../../libs/resolve-provision-disks.js'
import * as seedIso from '../../libs/seed/iso.js'
import * as seedRun from '../../libs/seed/run.js'
import * as pipeline from '../../libs/up-pipeline.js'
import { up } from './up.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmFlagStore } from '../../libs/flag-store.js' */
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

const sampleDisks = {
  os: { path: '/tmp/os.qcow2', size: '20G' },
  attached: [{ id: 'vw', path: '/tmp/vw.qcow2' }],
  dir: '/tmp/vms/rocky',
}

/**
 * @param {{ hasInstalled?: boolean }} [opts]
 * @returns {VmFlagStore}
 */
function fakeFlagStore(opts = {}) {
  const hasInstalled = Boolean(opts.hasInstalled)
  return /** @type {VmFlagStore} */ (
    /** @type {never} */ ({
      async has() {
        return hasInstalled
      },
      async get() {
        return true
      },
      async set() {},
      async delete() {},
      async entry() {
        return { name: 'installed', schema: {}, value: true }
      },
    })
  )
}

/** @typedef {VmUpBackend<any, any>} AnyBackend */

/**
 * @returns {Promise<{ backend: AnyBackend }>}
 */
async function captureBackend() {
  /** @type {AnyBackend | null} */
  let backend = null
  spyOn(pipeline, 'runVmUp').mockImplementation(async (_argv, b) => {
    backend = /** @type {AnyBackend} */ (/** @type {never} */ (b))
  })
  await up(
    /** @type {VmArgv} */ ({
      name: 'rocky',
      connect: 'qemu:///system',
      dryRun: true,
      env: 'dev',
    }),
  )
  if (!backend) throw new Error('backend not captured')
  return { backend }
}

/**
 * @param {AnyBackend} backend
 * @param {VmFlagStore} flags
 * @param {Partial<VmArgv>} [argvExtra]
 */
async function prepareSession(backend, flags, argvExtra = {}) {
  spyOn(resolveDisks, 'resolveProvisionDisks').mockResolvedValue(sampleResolved)
  spyOn(download, 'downloadImage').mockResolvedValue('/tmp/base.qcow2')
  spyOn(disks, 'ensureDisks').mockResolvedValue(
    /** @type {Awaited<ReturnType<typeof disks.ensureDisks>>} */ (
      /** @type {never} */ (sampleDisks)
    ),
  )
  spyOn(util, 'requireBins').mockResolvedValue(undefined)
  spyOn(util, 'which').mockResolvedValue('/usr/bin/virsh')
  spyOn(libvirt, 'domainExists').mockResolvedValue(false)
  spyOn(libvirt, 'ensureDefaultNetwork').mockResolvedValue(undefined)
  spyOn(libvirt, 'createFlagStore').mockReturnValue(
    /** @type {ReturnType<typeof libvirt.createFlagStore>} */ (/** @type {never} */ (flags)),
  )
  spyOn(console, 'log').mockImplementation(() => {})
  const argv = /** @type {VmArgv} */ ({
    name: 'rocky',
    connect: 'qemu:///system',
    memory: 2048,
    vcpus: 2,
    network: 'user',
    osinfo: 'rocky9',
    wipeOs: false,
    forceDownload: false,
    env: 'dev',
    target: 'workstation',
    ...argvExtra,
  })
  await /** @type {NonNullable<AnyBackend['prepare']>} */ (backend.prepare)(argv)
  return argv
}

afterEach(() => {
  // @ts-expect-error restore
  pipeline.runVmUp.mockRestore?.()
  // @ts-expect-error restore
  seedRun.runSeed.mockRestore?.()
  // @ts-expect-error restore
  seedIso.ensureSeed.mockRestore?.()
  // @ts-expect-error restore
  download.downloadImage.mockRestore?.()
  // @ts-expect-error restore
  disks.ensureDisks.mockRestore?.()
  // @ts-expect-error restore
  resolveDisks.resolveProvisionDisks.mockRestore?.()
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  util.which.mockRestore?.()
  // @ts-expect-error restore
  libvirt.domainExists.mockRestore?.()
  // @ts-expect-error restore
  libvirt.ensureDefaultNetwork.mockRestore?.()
  // @ts-expect-error restore
  libvirt.createFlagStore.mockRestore?.()
  // @ts-expect-error restore
  libvirt.detachSeedCdrom.mockRestore?.()
  // @ts-expect-error restore
  lifecycle.composeScrubSeed.mockRestore?.()
  // @ts-expect-error restore
  zx.$.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('workstation up', () => {
  test('delegates to runVmUp with a backend', async () => {
    const run = spyOn(pipeline, 'runVmUp').mockResolvedValue(undefined)
    const argv = /** @type {VmArgv} */ ({
      name: 'rocky',
      connect: 'qemu:///system',
      dryRun: true,
    })
    await up(argv)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toBe(argv)
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      dryRun: expect.any(Function),
      probeExisting: expect.any(Function),
      createFirstBoot: expect.any(Function),
      scrubSeed: expect.any(Function),
    })
  })

  test('prepare (resume path) does not call runSeed', async () => {
    const { backend } = await captureBackend()
    const seed = spyOn(seedRun, 'runSeed')
    await prepareSession(backend, fakeFlagStore())
    expect(seed).not.toHaveBeenCalled()
  })

  test('probeExisting installed/incomplete does not call runSeed', async () => {
    const { backend } = await captureBackend()
    const seed = spyOn(seedRun, 'runSeed')

    await prepareSession(backend, fakeFlagStore({ hasInstalled: true }))
    spyOn(libvirt, 'domainExists').mockResolvedValue(true)
    const installed = await backend.probeExisting(
      /** @type {VmArgv} */ ({ name: 'rocky', wipeOs: false }),
    )
    expect(installed?.installed).toBe(true)
    expect(seed).not.toHaveBeenCalled()

    await prepareSession(backend, fakeFlagStore({ hasInstalled: false }))
    spyOn(libvirt, 'domainExists').mockResolvedValue(true)
    const incomplete = await backend.probeExisting(
      /** @type {VmArgv} */ ({ name: 'rocky', wipeOs: false }),
    )
    expect(incomplete?.installed).toBe(false)
    expect(seed).not.toHaveBeenCalled()
  })

  test('createFirstBoot (wipe/create) calls runSeed', async () => {
    const { backend } = await captureBackend()
    const argv = await prepareSession(backend, fakeFlagStore())
    const seed = spyOn(seedRun, 'runSeed').mockResolvedValue({
      isoPath: '/tmp/qctl-test-seed.iso',
      imgPath: '/tmp/qctl-test-seed.img',
      profile: 'appliance',
      env: 'dev',
      instanceId: 'rocky-dev',
      keepDir: null,
    })
    spyOn(seedIso, 'ensureSeed').mockResolvedValue({
      path: '/tmp/qctl-test-seed.iso',
      format: 'raw',
      device: 'cdrom',
    })
    spyOn(zx, '$').mockImplementation(
      /** @type {typeof zx.$} */ (
        /** @type {never} */ (
          () => ({
            nothrow: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
          })
        )
      ),
    )

    const result = await backend.createFirstBoot(argv, new AbortController().signal, {
      wantSerial: false,
    })
    expect(seed).toHaveBeenCalled()
    expect(seed.mock.calls[0]?.[0]).toMatchObject({
      seedProfile: 'appliance',
      target: 'workstation',
      env: 'dev',
    })
    expect(result.created).toBeTruthy()
    expect(result.follow).toBeNull()
  })

  test('scrubSeed detaches seed CDROM after prepare', async () => {
    const { backend } = await captureBackend()
    await prepareSession(backend, fakeFlagStore())
    const detach = spyOn(libvirt, 'detachSeedCdrom').mockResolvedValue(true)
    spyOn(lifecycle, 'composeScrubSeed').mockImplementation((opts) => async () => {
      if (opts.after) await opts.after()
    })
    await backend.scrubSeed()
    expect(detach).toHaveBeenCalledWith('qemu:///system', 'rocky')
  })
})
