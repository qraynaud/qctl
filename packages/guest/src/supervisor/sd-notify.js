/**
 * Minimal systemd `sd_notify` over NOTIFY_SOCKET (Type=notify services).
 *
 * Uses unix datagram sockets; Node's public dgram typings omit unix path
 * overloads, so createSocket/send are cast at the call site.
 */
import { Buffer } from 'node:buffer'
import { createSocket } from 'node:dgram'
/** @import { Socket, SocketType } from 'node:dgram' */

/**
 * @param {string} state e.g. `READY=1` or `READY=1\nSTATUS=…`
 * @param {{ socketPath?: string }} [opts] override NOTIFY_SOCKET (tests)
 * @returns {Promise<boolean>} false when no notify socket configured
 */
export function sdNotify(state, opts = {}) {
  const raw = opts.socketPath ?? process.env.NOTIFY_SOCKET
  if (!raw) return Promise.resolve(false)

  const message = Buffer.from(state.endsWith('\n') ? state : `${state}\n`)
  const dest = raw.startsWith('@') ? `\0${raw.slice(1)}` : raw

  return new Promise((resolve, reject) => {
    const sock = /**
 * @type {Socket & {
      send: (msg: Buffer, path: string, cb: (err: Error | null) => void) => void
    }} */ (createSocket(/** @type {SocketType} */ ('unix_dgram')))
    sock.once('error', (err) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      reject(err)
    })

    sock.send(message, dest, (err) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      if (err) reject(err)
      else resolve(true)
    })
  })
}
