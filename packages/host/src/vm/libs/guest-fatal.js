/**
 * Race guest poweroff wait against serial fatal patterns (init-tank).
 * Shared by local and Proxmox drivers.
 */
import { chalk } from 'zx'

import { errMessage } from '../../lib/util.js'
import { isAbortError } from './wait.js'
/** @import { SerialFollow } from './console.js' */

export const GUEST_FATAL_ERROR = 'GuestFatalError'

/** @typedef {{ ok: boolean, aborted?: boolean, line?: string }} WaitOutcome */

/**
 * @param {Error | string | number | boolean | null | undefined | { name?: string }} err
 * @returns {boolean}
 */
export function isGuestFatalError(err) {
  return err instanceof Error && err.name === GUEST_FATAL_ERROR
}

/**
 * @param {string} line
 * @returns {Error}
 */
export function makeGuestFatalError(line) {
  const err = new Error(line)
  err.name = GUEST_FATAL_ERROR
  return err
}

/**
 * @typedef {object} WaitForSuccessOrGuestFatalOpts
 * @property {(signal: AbortSignal) => Promise<void>} waitUntilStopped
 *   Driver-specific poweroff wait (must honour `signal`).
 * @property {AbortSignal} signal  parent abort (SIGINT/SIGTERM)
 * @property {SerialFollow | null} consoleFollow
 */

/**
 * Wait until the guest stops (poweroff), or throw GuestFatalError when serial
 * matches a fatal pattern. On fatal: abort the wait; leave the VM running.
 *
 * @param {WaitForSuccessOrGuestFatalOpts} opts
 * @returns {Promise<void>}
 */
export async function waitForSuccessOrGuestFatal(opts) {
  const { waitUntilStopped, signal, consoleFollow } = opts
  if (!consoleFollow?.result) {
    await waitUntilStopped(signal)
    return
  }

  const waitAc = new AbortController()
  const onParentAbort = () => waitAc.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  /** @type {Promise<WaitOutcome>} */
  const shutOff = waitUntilStopped(waitAc.signal).then(
    () => ({ ok: true }),
    (err) => {
      if (isAbortError(err) && !signal?.aborted) {
        // Local abort from fatal match — swallow; fatal branch wins.
        return { ok: false, aborted: true }
      }
      throw err
    },
  )

  /** @type {Promise<WaitOutcome>} */
  const fatal = consoleFollow.result.then((hit) => ({
    ok: false,
    line: hit.line,
  }))

  try {
    const result = await Promise.race([shutOff, fatal])
    if (result.ok) return

    waitAc.abort()
    // Let shutOff settle so we don't leave an unhandled rejection.
    await shutOff.catch(() => {})

    if (result.line) throw makeGuestFatalError(result.line)
  } finally {
    signal?.removeEventListener('abort', onParentAbort)
  }
}

/**
 * @typedef {object} GuestFatalLeaveHints
 * @property {string} leaveHint
 * @property {string} destroyHint
 */

/**
 * Stop serial follow (if any) and print the standard “left running for diagnosis” banner.
 * @param {SerialFollow | null} consoleFollow
 * @param {Error | string} err
 * @param {GuestFatalLeaveHints} hints
 * @returns {Promise<void>}
 */
export async function reportGuestFatalLeaveRunning(consoleFollow, err, hints) {
  if (consoleFollow) await consoleFollow.stop()
  console.error(chalk.red(`vm: guest failure detected on serial — stopping wait`))
  console.error(chalk.red(`  ${errMessage(err)}`))
  console.error(chalk.yellow(hints.leaveHint))
  console.error(chalk.dim(hints.destroyHint))
  process.exitCode = 1
}
