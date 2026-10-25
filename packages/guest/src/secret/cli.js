/**
 * Shared glue for `qctl secret …`: resolve instance, prefer root (like quadlet).
 *
 * Rootless Quadlet `ExecStartPre` runs as `apps`, which has no sudo by design.
 * When passwordless sudo is unavailable, continue as the current user and sync
 * only the rootless store (rootful items are skipped inside `syncAll`).
 */
import { hideBin } from 'yargs/helpers'

import { resolveInstanceRoot } from '../supervisor/quadlet/context.js'
import { createSystem, tryEnsureRoot } from '../supervisor/quadlet/system.js'

/**
 * @typedef {object} SecretArgv
 * @property {string} [env] CLI override for env label (else OS config)
 * @property {boolean} [dryRun]
 * @property {boolean} [restart]
 */

/**
 * Resolve instance from `/etc/qctl/config.json`, prefer root via sudo, then `fn`.
 * @param {(root: string) => void | Promise<void>} fn
 */
export async function runSecretCommand(fn) {
  const root = resolveInstanceRoot()
  const sys = createSystem()
  // Prefer root (plugin cache, rootful secrets, Tier-0). Re-exec exits on success.
  tryEnsureRoot(hideBin(process.argv), sys)
  await fn(root)
}
