/**
 * Minimal systemd `sd_notify` over NOTIFY_SOCKET (Type=notify services).
 *
 * Bun's `node:dgram` only supports udp4/udp6 (no `unix_dgram`), so we shell out
 * to `systemd-notify` which speaks the notify protocol correctly.
 */
import { spawnSync } from 'node:child_process'

/**
 * @param {string} state e.g. `READY=1` or `READY=1\nSTATUS=…`
 * @param {{ socketPath?: string }} [opts] override NOTIFY_SOCKET (tests)
 * @returns {Promise<boolean>} false when no notify socket configured
 */
export function sdNotify(state, opts = {}) {
  const raw = opts.socketPath ?? process.env.NOTIFY_SOCKET
  if (!raw) return Promise.resolve(false)

  const vars = state
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (vars.length === 0) return Promise.resolve(false)

  return new Promise((resolve, reject) => {
    // Type=notify associates READY with the service main PID. A bare
    // systemd-notify child PID is ignored — pass --pid of this process.
    const r = spawnSync('systemd-notify', [`--pid=${process.pid}`, ...vars], {
      env: { ...process.env, NOTIFY_SOCKET: raw },
      encoding: 'utf8',
    })
    if (r.error) {
      reject(r.error)
      return
    }
    if (r.status !== 0) {
      const detail = (r.stderr || r.stdout || '').trim() || `exit ${r.status}`
      reject(new Error(`systemd-notify failed: ${detail}`))
      return
    }
    resolve(true)
  })
}
