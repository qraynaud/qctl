/**
 * Thin NDJSON client for the supervisor unix sockets.
 * Request/response validated via shared codecs in {@link ./protocol.js}.
 */
import net from 'node:net'

import { decodeResponseLine, decodeWireLine, encodeRequestLine } from './protocol.js'

/** @import { Socket } from 'node:net' */
/**
 * @import {
 *   QuadletRequest,
 *   SecretRequest,
 *   SupervisorRequest,
 *   SupervisorResponse,
 *   SupervisorStream,
 * } from './protocol.js'
 */

/** @typedef {QuadletRequest | SecretRequest} StreamingRequest */

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
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 *   `timeoutMs: 0` disables the client timeout (long `watch` RPCs).
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
    let settled = false
    /**
     * @param {(v: SupervisorResponse) => void} ok
     * @param {(e: Error) => void} bad
     */
    const settle = (ok, bad) => ({
      /**
       * @param {SupervisorResponse} v
       */
      resolve(v) {
        if (settled) return
        settled = true
        ok(v)
      },
      /**
       * @param {Error} e
       */
      reject(e) {
        if (settled) return
        settled = true
        bad(e)
      },
    })
    const s = settle(resolve, reject)

    sock.on('connect', () => {
      sock?.write(line)
    })
    sock.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const one = buf.slice(0, nl)
      try {
        s.resolve(decodeResponseLine(one))
      } catch (err) {
        s.reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    sock.on('error', (err) => {
      if (ac.signal.aborted || opts.signal?.aborted) {
        s.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }
      const code = /** @type {NodeJS.ErrnoException} */ (err).code
      if (code === 'ECONNREFUSED' || code === 'ENOENT') {
        s.reject(new SupervisorUnavailableError(sockPath, err))
        return
      }
      s.reject(err)
    })
    sock.on('close', () => {
      if (settled) return
      if (ac.signal.aborted || opts.signal?.aborted) {
        s.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }
      s.reject(new Error(`qctl-supervisor: connection closed before response (${sockPath})`))
    })
  })

  /** @type {Promise<SupervisorResponse>} */
  let raced = once
  if (timeoutMs > 0) {
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
    raced = Promise.race([once, timeout])
  }

  const onAbort = () => {
    try {
      sock?.destroy()
    } catch {
      // ignore
    }
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  if (opts.signal?.aborted) onAbort()

  return raced.finally(() => {
    ac.abort()
    opts.signal?.removeEventListener('abort', onAbort)
    try {
      sock?.destroy()
    } catch {
      // ignore
    }
  })
}

/**
 * Streaming RPC (quadlet / secret): one request, zero-or-more stream frames, then a final response.
 * @param {string} sockPath
 * @param {StreamingRequest} req
 * @param {{
 *   onStdout?: (data: string) => void,
 *   onStderr?: (data: string) => void,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} [opts]
 *   `timeoutMs: 0` disables the client timeout (long `quadlet up` / `secret sync`).
 * @returns {Promise<SupervisorResponse>}
 */
export function supervisorStreamingRequest(sockPath, req, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 0
  const line = encodeRequestLine(req)

  /** @type {Socket | undefined} */
  let sock
  const ac = new AbortController()

  const once = new Promise((resolve, reject) => {
    sock = net.connect(sockPath)
    sock.setEncoding('utf8')
    let buf = ''
    let settled = false
    /**
     * @param {(v: SupervisorResponse) => void} ok
     * @param {(e: Error) => void} bad
     */
    const settle = (ok, bad) => ({
      /**
       * @param {SupervisorResponse} v
       */
      resolve(v) {
        if (settled) return
        settled = true
        ok(v)
      },
      /**
       * @param {Error} e
       */
      reject(e) {
        if (settled) return
        settled = true
        bad(e)
      },
    })
    const s = settle(resolve, reject)

    /**
     * @param {string} chunk
     */
    const consume = (chunk) => {
      buf += chunk
      while (true) {
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        const one = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!one.trim()) continue
        /** @type {SupervisorStream | SupervisorResponse} */
        let msg
        try {
          msg = decodeWireLine(one)
        } catch (err) {
          s.reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        if ('stream' in msg) {
          if (msg.stream === 'stdout') opts.onStdout?.(msg.data)
          else opts.onStderr?.(msg.data)
          continue
        }
        s.resolve(msg)
        return
      }
    }

    sock.on('connect', () => {
      sock?.write(line)
    })
    sock.on('data', (chunk) => {
      consume(typeof chunk === 'string' ? chunk : String(chunk))
    })
    sock.on('error', (err) => {
      if (ac.signal.aborted || opts.signal?.aborted) {
        s.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }
      const code = /** @type {NodeJS.ErrnoException} */ (err).code
      if (code === 'ECONNREFUSED' || code === 'ENOENT') {
        s.reject(new SupervisorUnavailableError(sockPath, err))
        return
      }
      s.reject(err)
    })
    sock.on('close', () => {
      if (settled) return
      if (ac.signal.aborted || opts.signal?.aborted) {
        s.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }
      s.reject(new Error(`qctl-supervisor: connection closed before response (${sockPath})`))
    })
  })

  /** @type {Promise<SupervisorResponse>} */
  let raced = once
  if (timeoutMs > 0) {
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
    raced = Promise.race([once, timeout])
  }

  const onAbort = () => {
    try {
      sock?.destroy()
    } catch {
      // ignore
    }
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  if (opts.signal?.aborted) onAbort()

  return raced.finally(() => {
    ac.abort()
    opts.signal?.removeEventListener('abort', onAbort)
    try {
      sock?.destroy()
    } catch {
      // ignore
    }
  })
}

/**
 * @param {string} sockPath
 * @param {QuadletRequest} req
 * @param {Parameters<typeof supervisorStreamingRequest>[2]} [opts]
 * @returns {Promise<SupervisorResponse>}
 */
export function supervisorQuadletRequest(sockPath, req, opts) {
  return supervisorStreamingRequest(sockPath, req, opts)
}

/**
 * @param {string} sockPath
 * @param {SecretRequest} req
 * @param {Parameters<typeof supervisorStreamingRequest>[2]} [opts]
 * @returns {Promise<SupervisorResponse>}
 */
export function supervisorSecretRequest(sockPath, req, opts) {
  return supervisorStreamingRequest(sockPath, req, opts)
}
