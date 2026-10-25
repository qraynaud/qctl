import { INSTALLED, VmFlagNotFoundError } from './flags.js'
import { reportSerialWaitOutcome, runVmUp } from './up-pipeline.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */
/** @import { SerialFollow } from './console.js' */
/** @import { VmFlagStore } from './flag-store.js' */
/** @import { VmUpBackend } from './up-pipeline.js' */

/**
 * @param {{ value?: boolean }} [opts]
 * @returns {VmFlagStore & { ops: string[] }}
 */
function mockFlags(opts = {}) {
  /** @type {boolean | undefined} */
  let value = opts.value
  /** @type {string[]} */
  const ops = []
  /** @type {VmFlagStore & { ops: string[] }} */
  const store = {
    ops,
    async has(flag) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push('has')
      return value !== undefined
    },
    async get(flag) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push('get')
      if (value === undefined) throw new VmFlagNotFoundError(flag.name)
      return /** @type {never} */ (value)
    },
    async set(flag, v) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push(`set:${v}`)
      value = /** @type {boolean} */ (v)
    },
    async delete(flag) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push('delete')
      value = undefined
    },
    async entry(flag) {
      const out = await this.get(flag)
      return { name: flag.name, schema: flag.schema, value: out }
    },
  }
  return store
}

/**
 * @typedef {Pick<
 *   VmUpBackend<string, string>,
 *   'dryRun' | 'probeExisting' | 'createFirstBoot' | 'flags' | 'scrubSeed'
 * >} BackendRequired
 * @param {Partial<VmUpBackend<string, string>> & BackendRequired} overrides
 * @returns {VmUpBackend<string, string>}
 */
function backend(overrides) {
  return {
    reconcile: async () => {},
    startWithoutSerial: async () => {},
    startWithSerial: async () => fakeFollow(),
    finishResumeNoConsole: async () => {},
    finishResumeOk: async () => {},
    resumeFailHint: () => 'resume-fail',
    finishFirstBootNoConsole: async () => {},
    finishFirstBootOk: async () => {},
    firstBootFailHint: () => 'first-fail',
    finishContinueNoConsole: async () => {},
    finishContinueOk: async () => {},
    continueFailHint: () => 'continue-fail',
    ...overrides,
  }
}

/** @returns {SerialFollow} */
function fakeFollow() {
  return {
    stop: async () => {},
    result: new Promise(() => {}),
  }
}

describe('runVmUp', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  test('dry-run calls dryRun only', async () => {
    /** @type {string[]} */
    const calls = []
    const flags = mockFlags()
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: true }),
      backend({
        flags,
        scrubSeed: async () => {
          calls.push('scrub')
        },
        dryRun: async () => {
          calls.push('dryRun')
        },
        prepare: async () => {
          calls.push('prepare')
        },
        probeExisting: async () => {
          calls.push('probe')
          return { existing: 'existing', installed: true }
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
      }),
    )
    expect(calls).toEqual(['dryRun'])
  })

  test('installed existing resumes (skips first boot)', async () => {
    /** @type {string[]} */
    const calls = []
    const flags = mockFlags({ value: true })
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, noConsole: true, timeout: 1 }),
      backend({
        flags,
        scrubSeed: async () => {
          calls.push('scrub')
        },
        dryRun: async () => {},
        prepare: async () => {
          calls.push('prepare')
        },
        probeExisting: async () => {
          calls.push('probe')
          return { existing: 'existing', installed: true }
        },
        reconcile: async () => {
          calls.push('reconcile')
        },
        startWithoutSerial: async () => {
          calls.push('start')
        },
        finishResumeNoConsole: async () => {
          calls.push('finishResume')
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
      }),
    )
    expect(calls).toEqual(['prepare', 'probe', 'reconcile', 'start', 'finishResume'])
    expect(flags.ops).toEqual([])
    expect(calls).not.toContain('scrub')
    expect(calls).not.toContain('create')
  })

  test('already-up installed skips start and serial', async () => {
    /** @type {string[]} */
    const calls = []
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, timeout: 1 }),
      backend({
        flags: mockFlags({ value: true }),
        scrubSeed: async () => {},
        dryRun: async () => {},
        probeExisting: async () => ({ existing: 'existing', installed: true }),
        reconcile: async () => {
          calls.push('reconcile')
        },
        isAlreadyUp: () => true,
        startWithoutSerial: async () => {
          calls.push('start')
        },
        startWithSerial: async () => {
          calls.push('startSerial')
          return fakeFollow()
        },
        finishResumeOk: async () => {
          calls.push('finishOk')
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
      }),
    )
    expect(calls).toEqual(['reconcile', 'finishOk'])
  })

  test('incomplete existing continues first-boot (no create, marks installed)', async () => {
    /** @type {string[]} */
    const calls = []
    const flags = mockFlags()
    /** @type {SerialFollow} */
    const follow = {
      stop: async () => {
        calls.push('stop')
      },
      result: Promise.resolve({ status: 'ok', line: 'Final Stage' }),
    }
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, timeout: 5 }),
      backend({
        flags,
        scrubSeed: async () => {
          calls.push('scrub')
        },
        dryRun: async () => {},
        probeExisting: async () => {
          calls.push('probe')
          return { existing: 'existing', installed: false }
        },
        reconcile: async () => {
          calls.push('reconcile')
        },
        startWithSerial: async (_a, _e, mode) => {
          calls.push(`startSerial:${mode}`)
          return follow
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
        finishContinueOk: async () => {
          calls.push('finishContinueOk')
        },
      }),
    )
    expect(calls).toEqual(['probe', 'startSerial:cloud-init', 'stop', 'scrub', 'finishContinueOk'])
    expect(calls).not.toContain('create')
    expect(flags.ops).toEqual(['set:true'])
  })

  test('incomplete continue OK on multi-user line still marks installed + scrub', async () => {
    const flags = mockFlags()
    /** @type {string[]} */
    const calls = []
    const follow = {
      stop: async () => {},
      result: Promise.resolve({
        status: /** @type {const} */ ('ok'),
        line: 'Reached target Multi-User System',
      }),
    }
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, timeout: 5 }),
      backend({
        flags,
        scrubSeed: async () => {
          calls.push('scrub')
        },
        dryRun: async () => {},
        probeExisting: async () => ({ existing: 'existing', installed: false }),
        startWithSerial: async () => follow,
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
        finishContinueOk: async () => {
          calls.push('finishContinueOk')
        },
      }),
    )
    expect(calls).toEqual(['scrub', 'finishContinueOk'])
    expect(flags.ops).toEqual(['set:true'])
  })

  test('missing VM runs first boot and marks installed', async () => {
    /** @type {string[]} */
    const calls = []
    const flags = mockFlags()
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, noConsole: true, timeout: 1 }),
      backend({
        flags,
        scrubSeed: async () => {
          calls.push('scrub')
        },
        dryRun: async () => {},
        probeExisting: async () => {
          calls.push('probe')
          return null
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
        finishFirstBootNoConsole: async () => {
          calls.push('finishCreate')
        },
        finishFirstBootOk: async () => {
          calls.push('finishOk')
        },
      }),
    )
    expect(calls).toEqual(['probe', 'create', 'finishCreate'])
    expect(flags.ops).not.toContain('set:true')
  })

  test('wipeOs clears installed then creates', async () => {
    /** @type {string[]} */
    const calls = []
    const flags = mockFlags({ value: true })
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, wipeOs: true, noConsole: true, timeout: 1 }),
      backend({
        flags,
        scrubSeed: async () => {},
        dryRun: async () => {},
        probeExisting: async () => {
          calls.push('probe')
          return null
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
        finishFirstBootNoConsole: async () => {
          calls.push('finishCreate')
        },
      }),
    )
    expect(calls).toEqual(['probe', 'create', 'finishCreate'])
    expect(flags.ops).toEqual(['has', 'delete'])
  })

  test('first boot uses openSerialAfterCreate when create returns no follow', async () => {
    /** @type {string[]} */
    const calls = []
    const flags = mockFlags()
    /** @type {SerialFollow} */
    const follow = {
      stop: async () => {
        calls.push('stop')
      },
      result: Promise.resolve({ status: 'ok', line: 'done' }),
    }
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, timeout: 5 }),
      backend({
        flags,
        scrubSeed: async () => {
          calls.push('scrub')
        },
        dryRun: async () => {},
        probeExisting: async () => null,
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
        openSerialAfterCreate: async () => {
          calls.push('openSerial')
          return follow
        },
        finishFirstBootOk: async () => {
          calls.push('finishOk')
        },
      }),
    )
    expect(calls).toEqual(['create', 'openSerial', 'stop', 'scrub', 'finishOk'])
    expect(flags.ops).toContain('set:true')
  })
})

describe('reportSerialWaitOutcome', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  test('ok returns true without setting failure exitCode', () => {
    process.exitCode = 0
    const ok = reportSerialWaitOutcome(
      { status: 'ok', line: 'ready' },
      { okTitle: 'ok', failTitle: 'fail', leaveHint: 'leave' },
    )
    expect(ok).toBe(true)
    expect(process.exitCode).toBe(0)
  })

  test('fail sets exitCode 1', () => {
    const ok = reportSerialWaitOutcome(
      { status: 'fail', line: 'boom' },
      { okTitle: 'ok', failTitle: 'fail', leaveHint: 'leave' },
    )
    expect(ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })
})
