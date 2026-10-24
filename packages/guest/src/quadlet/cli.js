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
 * @typedef {object} QuadletArgv
 * @property {string | string[]} [app]
 * @property {string | string[]} [apps]
 * @property {boolean} [dryRun]
 * @property {boolean} [install]
 */

/**
 * Normalize yargs `apps` / legacy `app` into a string list.
 * @param {QuadletArgv} argv
 * @returns {string[]}
 */
export function argvApps(argv) {
  const raw = argv.apps ?? argv.app
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string' && raw) return [raw]
  return []
}

/**
 * Escalate to root, resolve the instance from `/etc/qctl/config.json`, run `fn`.
 * @param {(ctx: QuadletContext) => void | Promise<void>} fn
 * @param {{ escalate?: boolean }} [opts]
 */
export async function runQuadletCommand(fn, opts = {}) {
  try {
    const root = resolveInstanceRoot()
    const ctx = createContext({ root })
    if (opts.escalate !== false) {
      // Re-exec as root; instance root comes from OS config (not argv).
      ensureRoot(hideBin(process.argv), ctx.sys)
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
