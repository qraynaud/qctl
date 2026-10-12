import { reportSerialWaitOutcome, runVmUp } from './up-pipeline.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */
/** @import { SerialFollow } from './console.js' */
/** @import { VmUpBackend } from './up-pipeline.js' */

/**
 * @typedef {Pick<
 *   VmUpBackend<string, string>,
 *   'dryRun' | 'findRunnableExisting' | 'createFirstBoot'
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
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: true }),
      backend({
        dryRun: async () => {
          calls.push('dryRun')
        },
        prepare: async () => {
          calls.push('prepare')
        },
        findRunnableExisting: async () => {
          calls.push('find')
          return 'existing'
        },
        createFirstBoot: async () => {
          calls.push('create')
          return { created: 'c', follow: null }
        },
      }),
    )
    expect(calls).toEqual(['dryRun'])
  })

  test('existing domain skips first boot', async () => {
    /** @type {string[]} */
    const calls = []
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, noConsole: true, timeout: 1 }),
      backend({
        dryRun: async () => {
          calls.push('dryRun')
        },
        prepare: async () => {
          calls.push('prepare')
        },
        findRunnableExisting: async () => {
          calls.push('find')
          return 'existing'
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
    expect(calls).toEqual(['prepare', 'find', 'reconcile', 'start', 'finishResume'])
  })

  test('already-up skips start and serial', async () => {
    /** @type {string[]} */
    const calls = []
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, timeout: 1 }),
      backend({
        dryRun: async () => {},
        findRunnableExisting: async () => 'existing',
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

  test('missing domain runs first boot', async () => {
    /** @type {string[]} */
    const calls = []
    await runVmUp(
      /** @type {VmArgv} */ ({ dryRun: false, noConsole: true, timeout: 1 }),
      backend({
        dryRun: async () => {},
        findRunnableExisting: async () => {
          calls.push('find')
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
    expect(calls).toEqual(['find', 'create', 'finishCreate'])
  })

  test('first boot uses openSerialAfterCreate when create returns no follow', async () => {
    /** @type {string[]} */
    const calls = []
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
        dryRun: async () => {},
        findRunnableExisting: async () => null,
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
    expect(calls).toEqual(['create', 'openSerial', 'stop', 'finishOk'])
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
