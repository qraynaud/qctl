/**
 * Shared yargs glue for `qctl quadlet …`.
 */
import { hideBin } from 'yargs/helpers'

import { createContext, resolveInstanceRoot } from './context.js'
import { QuadletError } from './errors.js'
import { ensureRoot } from './system.js'
/** @import { Argv } from 'yargs' */
/** @import { QuadletContext } from './context.js' */

/**
 * Add the common `--root` option.
 * @template {Argv} T
 * @param {T} yargs
 * @returns {T}
 */
export function withRootOption(yargs) {
  return /** @type {T} */ (
    yargs.option('root', {
      type: 'string',
      describe: 'Instance root (default: $QCTL_ROOT, else walk up from cwd to provision/ + qctl:)',
    })
  )
}

/**
 * @typedef {object} QuadletArgv
 * @property {string} [root]
 * @property {string} [app]
 * @property {boolean} [dryRun]
 * @property {boolean} [install]
 */

/**
 * Escalate to root, resolve the instance, run `fn`, map errors to exit codes.
 * @param {QuadletArgv} argv
 * @param {(ctx: QuadletContext) => void | Promise<void>} fn
 * @param {{ escalate?: boolean }} [opts]
 */
export async function runQuadletCommand(argv, fn, opts = {}) {
  try {
    const root = resolveInstanceRoot({
      root: typeof argv.root === 'string' ? argv.root : undefined,
    })
    const ctx = createContext({ root })
    if (opts.escalate !== false) {
      // Re-exec as root with an explicit --root so sudo's cwd/env cannot change resolution.
      const userArgv = hideBin(process.argv)
      const hasRoot = userArgv.some((a) => a === '--root' || a.startsWith('--root='))
      ensureRoot(hasRoot ? userArgv : [...userArgv, '--root', root], ctx.sys)
    }
    await fn(ctx)
  } catch (e) {
    if (e instanceof QuadletError) {
      console.error(`quadlet: ERROR: ${e.message}`)
      process.exitCode = 1
      return
    }
    throw e
  }
}
