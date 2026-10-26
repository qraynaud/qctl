import * as seedRun from './seed/run.js'
import { reportSerialWaitOutcome, runVmInitTank, runVmUp } from './up-pipeline.js'
import * as upPrepare from './up-prepare.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext, VmDriverRegistration, VmSpecs } from '../driver-contract.js' */

/** @returns {VmContext} */
function ctx() {
  return {
    name: 'rocky',
    env: 'dev',
    timeout: 60,
    dryRun: false,
  }
}

/** @returns {Partial<VmSpecs>} */
function softSpecs() {
  return { memory: 4096, vcpus: 2 }
}

/**
 * @param {Partial<VmDriverRegistration> & Pick<VmDriverRegistration, 'id'>} overrides
 * @returns {VmDriverRegistration}
 */
function mockModule(overrides) {
  return {
    find: async () => null,
    create: async () => ({}),
    start: async () => null,
    createFlagStore: async () =>
      /** @type {never} */ ({
        get: async () => {
          throw Object.assign(new Error('missing'), { code: 'FLAG_NOT_FOUND' })
        },
        set: async () => {},
        delete: async () => {},
      }),
    detachSeed: async () => {},
    destroy: async () => {},
    reconcile: async () => {},
    powerState: async () => ({ kind: 'absent' }),
    ...overrides,
  }
}

describe('runVmUp (module)', () => {
  test('dry-run returns without create', async () => {
    let created = false
    await runVmUp(
      { ...ctx(), dryRun: true },
      { console: false },
      mockModule({
        id: /** @type {never} */ ('workstation'),
        create: async () => {
          created = true
          return {}
        },
      }),
      softSpecs(),
    )
    expect(created).toBe(false)
  })

  test('resume installed starts without serial', async () => {
    // Avoid requireBins → process.exit(1) on CI hosts without libvirt packages.
    spyOn(upPrepare, 'prepareHostForUp').mockResolvedValue(undefined)
    /** @type {unknown} */
    let startOpts = null
    const handle = { name: 'rocky' }
    try {
      await runVmUp(
        ctx(),
        { console: true },
        mockModule({
          id: /** @type {never} */ ('workstation'),
          find: async () => handle,
          createFlagStore: async () =>
            /** @type {never} */ ({
              has: async () => true,
              get: async () => true,
              set: async () => {},
              delete: async () => {},
            }),
          powerState: async () => ({ kind: 'stopped', detail: 'shut off' }),
          start: async (_c, _v, opts) => {
            startOpts = opts
            return null
          },
        }),
        softSpecs(),
      )
      expect(startOpts).toEqual({ serial: false })
    } finally {
      // @ts-expect-error restore
      upPrepare.prepareHostForUp.mockRestore?.()
    }
  })

  test('continue first-boot seeds before start when not installed', async () => {
    spyOn(upPrepare, 'prepareHostForUp').mockResolvedValue(undefined)
    /** @type {string[]} */
    const order = []
    spyOn(seedRun, 'runSeed').mockImplementation(async () => {
      order.push('seed')
      return {
        isoPath: '/tmp/seed.iso',
        imgPath: '/tmp/seed.img',
        profile: /** @type {const} */ ('appliance'),
        env: 'dev',
        instanceId: 'rocky-dev',
        keepDir: null,
      }
    })
    const handle = { name: 'rocky' }
    try {
      await expect(
        runVmUp(
          { ...ctx(), profile: 'workstation' },
          { console: false },
          mockModule({
            id: /** @type {never} */ ('workstation'),
            find: async () => handle,
            createFlagStore: async () =>
              /** @type {never} */ ({
                has: async () => false,
                get: async () => {
                  throw Object.assign(new Error('missing'), { code: 'FLAG_NOT_FOUND' })
                },
                set: async () => {},
                delete: async () => {},
              }),
            // Stop before markInstalled → scrubSeed (needs an instance repo).
            start: async () => {
              order.push('start')
              throw new Error('stop-after-start')
            },
          }),
          softSpecs(),
        ),
      ).rejects.toThrow('stop-after-start')
      expect(order).toEqual(['seed', 'start'])
    } finally {
      // @ts-expect-error restore
      upPrepare.prepareHostForUp.mockRestore?.()
      // @ts-expect-error restore
      seedRun.runSeed.mockRestore?.()
    }
  })
})

describe('runVmInitTank', () => {
  afterEach(() => {
    // @ts-expect-error restore
    console.log.mockRestore?.()
  })

  test('dry-run does not create', async () => {
    let created = false
    spyOn(console, 'log').mockImplementation(() => {})
    await runVmInitTank(
      { ...ctx(), dryRun: true },
      { console: false },
      mockModule({
        id: /** @type {never} */ ('workstation'),
        create: async () => {
          created = true
          return {}
        },
      }),
      softSpecs(),
    )
    expect(created).toBe(false)
  })
})

describe('reportSerialWaitOutcome', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  test('ok/fail', () => {
    expect(
      reportSerialWaitOutcome(
        { status: 'ok', line: 'hi' },
        { okTitle: 'ok', failTitle: 'fail', leaveHint: 'leave' },
      ),
    ).toBe(true)
    expect(
      reportSerialWaitOutcome(
        { status: 'fail', line: 'bye' },
        { okTitle: 'ok', failTitle: 'fail', leaveHint: 'leave' },
      ),
    ).toBe(false)
    expect(process.exitCode).toBe(1)
  })
})
