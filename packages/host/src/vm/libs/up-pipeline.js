/**
 * Shared `qctl vm up` orchestration. Drivers supply a {@link VmUpBackend};
 * this module owns dry-run / resume / incomplete / first-boot sequencing and
 * serial waits.
 *
 * Install state comes from an injected {@link VmFlagStore} (`INSTALLED`) — the
 * pipeline never imports target-private flag factories.
 *
 * Serial attach order differs by platform (workstation: before start; Proxmox: after),
 * so backends expose `startWithSerial` / `createFirstBoot` that return an open
 * follow when they already attached, or `openSerialAfterCreate` when not.
 */
import { chalk } from 'zx'

import { clearInstalled, markInstalled } from './installed-lifecycle.js'
import { isAbortError, waitForSerialOutcome } from './wait.js'

/** @import { VmArgv } from '../types.js' */
/** @import { SerialFollow, SerialWaitOutcome } from './console.js' */
/** @import { VmFlagStore } from './flag-store.js' */

/**
 * Probe result for an existing appliance VM/domain.
 *
 * @template TExisting
 * @typedef {object} VmUpProbe
 * @property {TExisting} existing
 * @property {boolean} installed
 */

/**
 * Platform backend for {@link runVmUp}. Handles are opaque to the pipeline.
 *
 * @template TExisting
 * @template TCreated
 * @typedef {object} VmUpBackend
 * @property {VmFlagStore | null} flags
 * @property {() => void | Promise<void>} scrubSeed
 * @property {(argv: VmArgv) => void | Promise<void>} [assertReady]
 * @property {(argv: VmArgv) => Promise<void>} dryRun
 * @property {(argv: VmArgv) => Promise<void>} [prepare]
 * @property {(argv: VmArgv) => Promise<VmUpProbe<TExisting> | null>} probeExisting
 * @property {(argv: VmArgv, existing: TExisting) => Promise<void>} reconcile
 * @property {(argv: VmArgv, existing: TExisting) => boolean | Promise<boolean>} [isAlreadyUp]
 * @property {(argv: VmArgv, existing: TExisting) => Promise<void>} startWithoutSerial
 * @property {(
 *   argv: VmArgv,
 *   existing: TExisting,
 *   mode: 'multi-user' | 'cloud-init',
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
 * @property {(
 *   existing: TExisting,
 *   signal: AbortSignal,
 * ) => Promise<void>} finishContinueNoConsole
 * @property {(
 *   existing: TExisting,
 *   signal: AbortSignal,
 * ) => Promise<void>} finishContinueOk
 * @property {(existing: TExisting) => Promise<void>} [finishContinueFail]
 * @property {(existing: TExisting) => string} continueFailHint
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

const CONTINUE_WAIT = {
  /** @param {number} timeoutSec */
  waiting: (timeoutSec) =>
    `vm: waiting for first-boot continue (cloud-init or multi-user; timeout ${timeoutSec}s)…`,
  /** @param {number} timeoutSec */
  timeoutLine: (timeoutSec) => `first-boot continue not seen within ${timeoutSec}s`,
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
 * @param {VmUpBackend<TExisting, TCreated>} backend
 * @returns {VmFlagStore}
 */
function requireFlags(backend) {
  if (!backend.flags) throw new Error('vm up: flag store not bound')
  return backend.flags
}

/**
 * @template TExisting
 * @template TCreated
 * @param {VmArgv} argv
 * @param {VmUpBackend<TExisting, TCreated>} backend
 * @param {TCreated} created
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function finishFirstBootSuccess(argv, backend, created, signal) {
  await markInstalled(requireFlags(backend), { scrubSeed: backend.scrubSeed })
  await backend.finishFirstBootOk(argv, created, signal)
}

/**
 * @template TExisting
 * @template TCreated
 * @param {VmUpBackend<TExisting, TCreated>} backend
 * @param {TExisting} existing
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function finishContinueSuccess(backend, existing, signal) {
  await markInstalled(requireFlags(backend), { scrubSeed: backend.scrubSeed })
  await backend.finishContinueOk(existing, signal)
}

/**
 * Existing VM without INSTALLED — continue first-boot wait (no create / re-seed).
 *
 * @template TExisting
 * @template TCreated
 * @param {VmArgv} argv
 * @param {VmUpBackend<TExisting, TCreated>} backend
 * @param {TExisting} existing
 * @param {number} timeoutSec
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function runIncompleteFirstBoot(argv, backend, existing, timeoutSec, signal) {
  console.log(chalk.cyan('vm: existing VM not marked installed — continuing first-boot'))

  if (argv.noConsole) {
    await backend.startWithoutSerial(argv, existing)
    await backend.finishContinueNoConsole(existing, signal)
    return
  }

  /** @type {SerialFollow | null} */
  let follow = null
  try {
    follow = await backend.startWithSerial(argv, existing, 'cloud-init')
    console.log(chalk.green('vm: started — streaming serial until first-boot continue'))
    const outcome = await waitSerial(follow, timeoutSec, signal, CONTINUE_WAIT)
    await follow.stop()
    follow = null
    if (
      reportSerialWaitOutcome(outcome, {
        okTitle: 'vm: first-boot continue OK',
        failTitle: 'vm: first-boot continue failed (or timed out)',
        leaveHint: backend.continueFailHint(existing),
      })
    ) {
      await finishContinueSuccess(backend, existing, signal)
    } else {
      await backend.finishContinueFail?.(existing)
    }
  } finally {
    if (follow) await follow.stop()
  }
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

    const probe = await backend.probeExisting(argv)

    if (probe?.installed) {
      const { existing } = probe
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

    if (probe != null) {
      await runIncompleteFirstBoot(argv, backend, probe.existing, timeoutSec, signal)
      return
    }

    if (argv.wipeOs && backend.flags) {
      await clearInstalled(backend.flags)
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
        await finishFirstBootSuccess(argv, backend, created, signal)
      } else {
        await backend.finishFirstBootFail?.(argv, created)
      }
    } finally {
      if (follow) await follow.stop()
    }
  })
}
