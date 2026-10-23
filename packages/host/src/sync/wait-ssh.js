/**
 * Wait until the appliance accepts an authenticated SSH session.
 * Shared by `qctl sync`, `vm up [apps…]`, and related guest over-SSH commands.
 */
import { chalk } from 'zx'

import { sleep } from '../vm/libs/wait.js'
import { sshConnect } from './ssh.js'

/** @import { SshConnectOpts } from './ssh.js' */

/**
 * @param {SshConnectOpts & {
 *   timeoutSec?: number
 *   pollMs?: number
 *   label?: string
 *   prefix?: string
 * }} opts
 *   `prefix` is the log line label (`vm`, `sync`, …).
 * @returns {Promise<void>}
 */
export async function waitForSsh(opts) {
  const timeoutSec = opts.timeoutSec ?? 180
  const pollMs = opts.pollMs ?? 2000
  const prefix = opts.prefix ?? 'vm'
  const label = opts.label || `${opts.username}@${opts.host}:${opts.port}`
  const deadline = Date.now() + timeoutSec * 1000
  /** @type {Error | null} */
  let lastErr = null

  console.log(chalk.cyan(`${prefix}: waiting for SSH ${label} (timeout ${timeoutSec}s)…`))

  while (Date.now() < deadline) {
    try {
      const conn = await sshConnect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        identity: opts.identity,
        readyTimeoutMs: Math.min(opts.readyTimeoutMs ?? 8_000, 8_000),
      })
      conn.end()
      console.log(chalk.green(`${prefix}: SSH ready (${label})`))
      return
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      await sleep(pollMs)
    }
  }

  const detail = lastErr?.message?.trim() || 'connection failed'
  throw new Error(
    `SSH not ready within ${timeoutSec}s (${label}): ${detail}\n`
      + '  Tip: qctl vm up  (wait until first-boot finishes), then retry',
  )
}
