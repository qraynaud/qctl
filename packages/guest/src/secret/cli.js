/**
 * Shared glue for `qctl secret …`: resolve instance, prefer root (like quadlet).
 *
 * Rootless Quadlet `ExecStartPre` runs as `apps`, which has no sudo by design.
 * When passwordless sudo is unavailable, continue as the current user and sync
 * only the rootless store (rootful items are skipped inside `syncAll`).
 */
import { hideBin } from 'yargs/helpers'

import { resolveInstanceRoot } from '../quadlet/context.js'
import { createSystem, tryEnsureRoot } from '../quadlet/system.js'

/**
 * @typedef {object} SecretArgv
 * @property {string} [root]
 * @property {string} [env]
 * @property {boolean} [dryRun]
 * @property {boolean} [restart]
 */

/**
 * @param {SecretArgv} argv
 * @param {(root: string) => void | Promise<void>} fn
 */
export async function runSecretCommand(argv, fn) {
  const root = resolveInstanceRoot({ root: typeof argv.root === 'string' ? argv.root : undefined })
  const sys = createSystem()
  const userArgv = hideBin(process.argv)
  const hasRoot = userArgv.some((a) => a === '--root' || a.startsWith('--root='))
  // Prefer root (plugin cache, rootful secrets, Tier-0). Re-exec exits on success.
  tryEnsureRoot(hasRoot ? userArgv : [...userArgv, '--root', root], sys)
  await fn(root)
}
