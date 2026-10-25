/**
 * Dual unix-socket supervisor server (apps + admin) with peercred ACL.
 */
import { chmodSync, chownSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { createInterface } from 'node:readline'

import { authorizeRpc, authorizeSecretParams } from './acl.js'
import { adminSockPath, appsSockPath } from './paths.js'
import { getPeerCred } from './peercred.js'
import {
  decodeRequestLine,
  encodeResponseLine,
  encodeStreamLine,
  isStreamingMethod,
} from './protocol.js'
import { ensureRunDir, isAppFailed, isAppReady, watchAppUntilNotReady } from './stamps.js'

/** @import { Socket } from 'node:net' */
/** @import { OsConfig } from '@qctl/shared' */
/** @import { PeerCred } from './peercred.js' */
/**
 * @import {
 *   EnsureRequest,
 *   EnsureResult,
 *   QuadletRequest,
 *   QuadletResult,
 *   ReleaseRequest,
 *   ReleaseResult,
 *   SecretRequest,
 *   SecretResult,
 *   SocketKind,
 *   StatusRequest,
 *   StatusResult,
 *   SupervisorRequest,
 *   SupervisorResponse,
 *   SupervisorResult,
 *   WatchRequest,
 *   WatchResult,
 * } from './protocol.js'
 */

/**
 * @typedef {{
 *   kind: SocketKind,
 *   peer: PeerCred,
 *   writeStdout?: (data: string) => void,
 *   writeStderr?: (data: string) => void,
 * }} HandlerCtx
 */

/**
 * @template TReq
 * @template TRes
 * @typedef {(req: TReq, ctx: HandlerCtx) => TRes | Promise<TRes>} MethodHandler
 */

/**
 * @typedef {object} SupervisorHandlers
 * @property {MethodHandler<EnsureRequest, EnsureResult>} [ensure]
 * @property {MethodHandler<ReleaseRequest, ReleaseResult>} [release]
 * @property {MethodHandler<StatusRequest, StatusResult>} [status]
 * @property {MethodHandler<WatchRequest, WatchResult>} [watch]
 * @property {MethodHandler<QuadletRequest, QuadletResult>} [quadlet]
 * @property {MethodHandler<SecretRequest, SecretResult>} [secret]
 */

/** @typedef {MethodHandler<SupervisorRequest, SupervisorResult>} DispatchFn */

/**
 * @typedef {object} SupervisorServerOpts
 * @property {OsConfig} osConfig
 * @property {string} runDir
 * @property {SupervisorHandlers} [handlers]
 * @property {(socket: Socket) => PeerCred} [getPeerCred]
 * @property {(line: string) => void} [log]
 * @property {boolean} [chownSockets] chown to apps/admin gids (needs root; default true)
 */

/**
 * @typedef {object} SupervisorServer
 * @property {string} appsPath
 * @property {string} adminPath
 * @property {() => Promise<void>} close
 */

/**
 * Fallback handlers when no AppHolds wired (tests): stamp status/watch only;
 * ensure/release are no-ops that do not touch systemd.
 * @param {string} runDir
 * @returns {SupervisorHandlers}
 */
export function stubHandlers(runDir) {
  return {
    ensure: (req) => ({
      method: 'ensure',
      app: req.params.app,
      refs: 1,
      engine: 'rootful',
      started: false,
    }),
    release: (req) => ({
      method: 'release',
      app: req.params.app,
      refs: 0,
      stopped: false,
    }),
    status: (req) => ({
      method: 'status',
      app: req.params.app,
      ready: isAppReady(req.params.app, runDir),
      failed: isAppFailed(req.params.app, runDir),
    }),
    watch: async (req) => {
      const reason = await watchAppUntilNotReady(req.params.app, { runDir })
      return { method: 'watch', app: req.params.app, reason }
    },
    quadlet: () => ({ method: 'quadlet', exitCode: 0 }),
    secret: () => ({ method: 'secret', exitCode: 0 }),
  }
}

/**
 * @param {SupervisorRequest} req
 * @param {HandlerCtx} ctx
 * @param {SupervisorHandlers} handlers
 * @returns {Promise<SupervisorResult | undefined>}
 */
async function dispatch(req, ctx, handlers) {
  // Correlated union: method key ↔ request/result pair; one call-site cast.
  const fn = /** @type {DispatchFn | undefined} */ (handlers[req.method])
  return fn?.(req, ctx)
}

/**
 * @param {string} line
 * @param {SocketKind} kind
 * @param {PeerCred} peer
 * @param {OsConfig} osConfig
 * @param {SupervisorHandlers} handlers
 * @returns {Promise<SupervisorResponse>}
 */
async function handleLine(line, kind, peer, osConfig, handlers) {
  try {
    const req = decodeRequestLine(line)
    const auth = authorizeRpc(kind, peer, req.method, osConfig)
    if (!auth.ok) return { id: req.id, ok: false, error: auth.error }

    const result = await dispatch(req, { kind, peer }, handlers)
    if (result === undefined) {
      return { id: req.id, ok: false, error: `no handler for ${req.method}` }
    }
    return { id: req.id, ok: true, result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Quadlet/secret may emit intermediate stream frames before the final response.
 * @param {string} line
 * @param {SocketKind} kind
 * @param {PeerCred} peer
 * @param {OsConfig} osConfig
 * @param {SupervisorHandlers} handlers
 * @param {Socket} socket
 * @returns {Promise<void>}
 */
async function handleStreamingLine(line, kind, peer, osConfig, handlers, socket) {
  try {
    const req = decodeRequestLine(line)
    if (!isStreamingMethod(req.method)) {
      socket.write(
        encodeResponseLine({
          id: req.id,
          ok: false,
          error: `internal: expected streaming method, got ${req.method}`,
        }),
      )
      return
    }
    const auth = authorizeRpc(kind, peer, req.method, osConfig)
    if (!auth.ok) {
      socket.write(encodeResponseLine({ id: req.id, ok: false, error: auth.error }))
      return
    }
    if (req.method === 'secret') {
      const paramAuth = authorizeSecretParams(kind, req.params)
      if (!paramAuth.ok) {
        socket.write(encodeResponseLine({ id: req.id, ok: false, error: paramAuth.error }))
        return
      }
    }
    /** @param {string} data */
    const writeStdout = (data) => {
      socket.write(encodeStreamLine({ id: req.id, stream: 'stdout', data }))
    }
    /** @param {string} data */
    const writeStderr = (data) => {
      socket.write(encodeStreamLine({ id: req.id, stream: 'stderr', data }))
    }
    const result = await dispatch(req, { kind, peer, writeStdout, writeStderr }, handlers)
    if (result === undefined) {
      socket.write(
        encodeResponseLine({ id: req.id, ok: false, error: `no handler for ${req.method}` }),
      )
      return
    }
    socket.write(encodeResponseLine({ id: req.id, ok: true, result }))
  } catch (err) {
    socket.write(
      encodeResponseLine({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
}

/**
 * @param {SocketKind} kind
 * @param {Socket} socket
 * @param {PeerCred} peer
 * @param {OsConfig} osConfig
 * @param {SupervisorHandlers} handlers
 */
async function serveConnection(kind, socket, peer, osConfig, handlers) {
  const lines = createInterface({ input: socket, crlfDelay: Infinity })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let method
    try {
      method = decodeRequestLine(trimmed).method
    } catch {
      socket.write(encodeResponseLine(await handleLine(trimmed, kind, peer, osConfig, handlers)))
      continue
    }
    if (isStreamingMethod(method)) {
      await handleStreamingLine(trimmed, kind, peer, osConfig, handlers, socket)
    } else {
      socket.write(encodeResponseLine(await handleLine(trimmed, kind, peer, osConfig, handlers)))
    }
  }
}

/**
 * @param {SupervisorServerOpts} opts
 * @returns {Promise<SupervisorServer>}
 */
export async function startSupervisorServer(opts) {
  const log = opts.log ?? (() => {})
  const peerCredFn = opts.getPeerCred ?? getPeerCred
  const runDir = opts.runDir
  const handlers = { ...stubHandlers(runDir), ...opts.handlers }
  const appsPath = appsSockPath(runDir)
  const adminPath = adminSockPath(runDir)

  ensureRunDir(runDir)
  for (const p of [appsPath, adminPath]) {
    try {
      unlinkSync(p)
    } catch {
      // absent
    }
  }

  /**
   * @param {SocketKind} kind
   * @param {Socket} socket
   */
  const onConnection = (kind, socket) => {
    /** @type {PeerCred} */
    let peer
    try {
      peer = peerCredFn(socket)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      socket.write(encodeResponseLine({ ok: false, error: msg }))
      socket.end()
      return
    }

    serveConnection(kind, socket, peer, opts.osConfig, handlers).catch((err) => {
      log(`qctl-supervisor: connection closed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  const appsServer = net.createServer((s) => onConnection('apps', s))
  const adminServer = net.createServer((s) => onConnection('admin', s))

  await new Promise((/** @type {(v?: void) => void} */ resolve, reject) => {
    appsServer.once('error', reject)
    appsServer.listen(appsPath, () => resolve())
  })
  await new Promise((/** @type {(v?: void) => void} */ resolve, reject) => {
    adminServer.once('error', reject)
    adminServer.listen(adminPath, () => resolve())
  })

  try {
    chmodSync(appsPath, 0o660)
    chmodSync(adminPath, 0o660)
  } catch (err) {
    log(`qctl-supervisor: chmod sockets: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (opts.chownSockets !== false) {
    try {
      chownSync(appsPath, 0, opts.osConfig.apps.gid)
      chownSync(adminPath, 0, opts.osConfig.admin.gid)
    } catch (err) {
      log(
        `qctl-supervisor: chown sockets (need root): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  log(`qctl-supervisor: listening ${appsPath} + ${adminPath}`)

  return {
    appsPath,
    adminPath,
    close: async () => {
      await Promise.all([
        new Promise((resolve) => appsServer.close(() => resolve(undefined))),
        new Promise((resolve) => adminServer.close(() => resolve(undefined))),
      ])
      for (const p of [appsPath, adminPath]) {
        try {
          unlinkSync(p)
        } catch {
          // ignore
        }
      }
    },
  }
}
