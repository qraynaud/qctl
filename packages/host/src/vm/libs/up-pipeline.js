/**
 * Shared `qctl vm up` orchestration. Drivers supply a {@link VmUpBackend};
 * this module owns dry-run / resume / first-boot sequencing and serial waits.
 *
 * Serial attach order differs by platform (workstation: before start; Proxmox: after),
 * so backends expose `startWithSerial` / `createFirstBoot` that return an open
 * follow when they already attached, or `openSerialAfterCreate` when not.
 */
import { chalk } from 'zx'

import { isAbortError, waitForSerialOutcome } from './wait.js'

/** @import { VmArgv } from '../types.js' */
/** @import { SerialFollow, SerialWaitOutcome } from './console.js' */

/**
 * Platform backend for {@link runVmUp}. Handles are opaque to the pipeline.
 *
 * @template TExisting
 * @template TCreated
 * @typedef {object} VmUpBackend
 * @property {(argv: VmArgv) => void | Promise<void>} [assertReady]
 * @property {(argv: VmArgv) => Promise<void>} dryRun
 * @property {(argv: VmArgv) => Promise<void>} [prepare]
 * @property {(argv: VmArgv) => Promise<TExisting | null>} findRunnableExisting
 * @property {(argv: VmArgv, existing: TExisting) => Promise<void>} reconcile
 * @property {(argv: VmArgv, existing: TExisting) => boolean | Promise<boolean>} [isAlreadyUp]
 * @property {(argv: VmArgv, existing: TExisting) => Promise<void>} startWithoutSerial
 * @property {(
 *   argv: VmArgv,
 *   existing: TExisting,
 *   mode: 'multi-user',
 * ) => Promise<SerialFollow>} startWithSerial
 * @property {(argv: VmArgv, existing: TExisting) => Promise<void>} finishResumeNoConsole
 * @property {(
 *   argv: VmArgv,
 *   existing: TExisting,
 *   signal: AbortSignal,
 * ) => Promise<void>} finishResumeOk
 * @property {(argv: VmArgv, existing: TExisting) => string} resumeFailHint
 * @property {(
 *   argv: VmArgv,
 *   signal: AbortSignal,
 *   opts: { wantSerial: boolean },
 * ) => Promise<{ created: TCreated, follow: SerialFollow | null }>} createFirstBoot
 * @property {(
 *   argv: VmArgv,
 *   created: TCreated,
 *   mode: 'cloud-init',
 * ) => Promise<SerialFollow>} [openSerialAfterCreate]
 * @property {(
 *   argv: VmArgv,
 *   created: TCreated,
 *   signal: AbortSignal,
 * ) => Promise<void>} finishFirstBootNoConsole
 * @property {(
 *   argv: VmArgv,
 *   created: TCreated,
 *   signal: AbortSignal,
 * ) => Promise<void>} finishFirstBootOk
 * @property {(argv: VmArgv, created: TCreated) => Promise<void>} [finishFirstBootFail]
 * @property {(argv: VmArgv, created: TCreated) => string} firstBootFailHint
 */

const MULTI_USER_WAIT = {
  /** @param {number} timeoutSec */
  waiting: (timeoutSec) => `vm: waiting for multi-user target (timeout ${timeoutSec}s)…`,
  /** @param {number} timeoutSec */
  timeoutLine: (timeoutSec) => `multi-user target not seen within ${timeoutSec}s`,
}

const CLOUD_INIT_WAIT = {
  /** @param {number} timeoutSec */
  waiting: (timeoutSec) => `vm: waiting for cloud-init Final Stage (timeout ${timeoutSec}s)…`,
  /** @param {number} timeoutSec */
  timeoutLine: (timeoutSec) => `cloud-init Final Stage not seen within ${timeoutSec}s`,
}

/**
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @returns {Promise<T | void>}
 */
export async function withUpSignals(fn) {
  const ac = new AbortController()
  const onSignal = () => ac.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    return await fn(ac.signal)
  } catch (err) {
    if (isAbortError(err) || ac.signal.aborted) {
      console.log(chalk.yellow('vm: up interrupted — left running'))
      process.exitCode = 130
      return
    }
    throw err
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

/**
 * @param {SerialWaitOutcome} outcome
 * @param {{ okTitle: string, failTitle: string, leaveHint: string }} labels
 * @returns {boolean}
 */
export function reportSerialWaitOutcome(outcome, labels) {
  if (outcome.status === 'ok') {
    console.log(chalk.green(labels.okTitle))
    console.log(chalk.dim(`  ${outcome.line}`))
    return true
  }
  console.error(chalk.red(labels.failTitle))
  console.error(chalk.red(`  ${outcome.line}`))
  console.error(chalk.yellow(labels.leaveHint))
  process.exitCode = 1
  return false
}

/**
 * @param {SerialFollow} follow
 * @param {number} timeoutSec
 * @param {AbortSignal} signal
 * @param {{ waiting: (n: number) => string, timeoutLine: (n: number) => string }} msgs
 * @returns {Promise<SerialWaitOutcome>}
 */
async function waitSerial(follow, timeoutSec, signal, msgs) {
  return waitForSerialOutcome(follow, timeoutSec, signal, {
    waiting: msgs.waiting(timeoutSec),
    timeoutLine: msgs.timeoutLine(timeoutSec),
  })
}

/**
 * @template TExisting
 * @template TCreated
 * @param {VmArgv} argv
 * @param {VmUpBackend<TExisting, TCreated>} backend
 * @returns {Promise<void>}
 */
export async function runVmUp(argv, backend) {
  await backend.assertReady?.(argv)
  if (argv.dryRun) {
    await backend.dryRun(argv)
    return
  }

  const timeoutSec = argv.timeout || 2700

  await withUpSignals(async (signal) => {
    await backend.prepare?.(argv)

    const existing = await backend.findRunnableExisting(argv)
    if (existing != null) {
      await backend.reconcile(argv, existing)

      if (await backend.isAlreadyUp?.(argv, existing)) {
        await backend.finishResumeOk(argv, existing, signal)
        return
      }

      if (argv.noConsole) {
        await backend.startWithoutSerial(argv, existing)
        await backend.finishResumeNoConsole(argv, existing)
        return
      }

      /** @type {SerialFollow | null} */
      let follow = null
      try {
        follow = await backend.startWithSerial(argv, existing, 'multi-user')
        console.log(chalk.green('vm: started — streaming serial until multi-user'))
        const outcome = await waitSerial(follow, timeoutSec, signal, MULTI_USER_WAIT)
        await follow.stop()
        follow = null
        if (
          reportSerialWaitOutcome(outcome, {
            okTitle: 'vm: guest multi-user OK',
            failTitle: 'vm: guest boot failed (or timed out)',
            leaveHint: backend.resumeFailHint(argv, existing),
          })
        ) {
          await backend.finishResumeOk(argv, existing, signal)
        }
      } finally {
        if (follow) await follow.stop()
      }
      return
    }

    const { created, follow: earlyFollow } = await backend.createFirstBoot(argv, signal, {
      wantSerial: !argv.noConsole,
    })

    if (argv.noConsole) {
      await backend.finishFirstBootNoConsole(argv, created, signal)
      return
    }

    /** @type {SerialFollow | null} */
    let follow = earlyFollow
    try {
      if (!follow) {
        const open = backend.openSerialAfterCreate
        if (!open) {
          throw new Error(
            'vm up: createFirstBoot returned no serial follow and openSerialAfterCreate is unset',
          )
        }
        follow = await open(argv, created, 'cloud-init')
      }
      const outcome = await waitSerial(follow, timeoutSec, signal, CLOUD_INIT_WAIT)
      await follow.stop()
      follow = null
      if (
        reportSerialWaitOutcome(outcome, {
          okTitle: 'vm: cloud-init Final Stage OK',
          failTitle: 'vm: cloud-init Final Stage failed (or timed out)',
          leaveHint: backend.firstBootFailHint(argv, created),
        })
      ) {
        await backend.finishFirstBootOk(argv, created, signal)
      } else {
        await backend.finishFirstBootFail?.(argv, created)
      }
    } finally {
      if (follow) await follow.stop()
    }
  })
}
