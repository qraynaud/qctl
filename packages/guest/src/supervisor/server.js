/**
 * Dual unix-socket supervisor server (apps + admin) with peercred ACL.
 */
import { chmodSync, chownSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { createInterface } from 'node:readline'

import { authorizeRpc } from './acl.js'
import { adminSockPath, appsSockPath } from './paths.js'
import { getPeerCred } from './peercred.js'
import { decodeRequestLine, encodeResponseLine } from './protocol.js'
import { ensureRunDir } from './stamps.js'

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
 * @typedef {{ kind: SocketKind, peer: PeerCred }} HandlerCtx
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
 * Default stub handlers for this slice (real ensure/systemctl comes later).
 * @returns {SupervisorHandlers}
 */
export function stubHandlers() {
  return {
    ensure: (req) => ({ stub: true, method: 'ensure', app: req.params.app }),
    release: (req) => ({ stub: true, method: 'release', app: req.params.app }),
    status: (req) => ({ stub: true, method: 'status', app: req.params.app }),
    watch: (req) => ({ stub: true, method: 'watch', app: req.params.app }),
    quadlet: (req) => ({ stub: true, method: 'quadlet', argv: req.params.argv }),
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
    socket.write(encodeResponseLine(await handleLine(trimmed, kind, peer, osConfig, handlers)))
  }
}

/**
 * @param {SupervisorServerOpts} opts
 * @returns {Promise<SupervisorServer>}
 */
export async function startSupervisorServer(opts) {
  const log = opts.log ?? (() => {})
  const peerCredFn = opts.getPeerCred ?? getPeerCred
  const handlers = { ...stubHandlers(), ...opts.handlers }
  const runDir = opts.runDir
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
