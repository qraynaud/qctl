/**
 * Thin NDJSON client for the supervisor unix sockets.
 * Request/response validated via shared codecs in {@link ./protocol.js}.
 */
import net from 'node:net'

import { decodeResponseLine, encodeRequestLine } from './protocol.js'

/** @import { Socket } from 'node:net' */
/** @import { SupervisorRequest, SupervisorResponse } from './protocol.js' */

export class SupervisorUnavailableError extends Error {
  /**
   * @param {string} sockPath
   * @param {Error} [cause]
   */
  constructor(sockPath, cause) {
    super(`qctl-supervisor not running (connect ${sockPath} failed)`)
    this.name = 'SupervisorUnavailableError'
    this.sockPath = sockPath
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * Send one request and wait for one response line.
 * @param {string} sockPath
 * @param {SupervisorRequest} req
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<SupervisorResponse>}
 */
export function supervisorRequest(sockPath, req, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const line = encodeRequestLine(req)

  /** @type {Socket | undefined} */
  let sock
  const ac = new AbortController()

  const once = new Promise((resolve, reject) => {
    sock = net.connect(sockPath)
    sock.setEncoding('utf8')
    let buf = ''

    sock.on('connect', () => {
      sock?.write(line)
    })
    sock.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const one = buf.slice(0, nl)
      try {
        resolve(decodeResponseLine(one))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    sock.on('error', (err) => {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code
      if (code === 'ECONNREFUSED' || code === 'ENOENT') {
        reject(new SupervisorUnavailableError(sockPath, err))
        return
      }
      reject(err)
    })
  })

  const timeout = new Promise((_resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`qctl-supervisor: timeout waiting for response (${sockPath})`))
    }, timeoutMs)
    ac.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
      },
      { once: true },
    )
  })

  return Promise.race([once, timeout]).finally(() => {
    ac.abort()
    try {
      sock?.destroy()
    } catch {
      // ignore
    }
  })
}
