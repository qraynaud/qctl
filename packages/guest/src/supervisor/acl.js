/**
 * Peercred + method allowlists for apps vs admin sockets.
 */
import { isAdminOnlyMethod, isAppsMethod } from './protocol.js'

/** @import { OsConfig } from '@qctl/shared' */
/** @import { PeerCred } from './peercred.js' */
/** @import { SocketKind } from './protocol.js' */

/**
 * @param {OsConfig} os
 * @returns {{ appsUid: number, adminUid: number }}
 */
export function uidsFromOsConfig(os) {
  return {
    appsUid: os.apps.uid,
    adminUid: os.admin.uid,
  }
}

/**
 * Whether this peer may open the socket at all.
 * @param {SocketKind} kind
 * @param {PeerCred} peer
 * @param {OsConfig} os
 * @returns {boolean}
 */
export function peerMayConnect(kind, peer, os) {
  const { appsUid, adminUid } = uidsFromOsConfig(os)
  if (peer.uid === 0) return true
  if (kind === 'apps') return peer.uid === appsUid
  return peer.uid === adminUid
}

/**
 * Whether this peer may invoke `method` on this socket.
 * @param {SocketKind} kind
 * @param {PeerCred} peer
 * @param {string} method
 * @param {OsConfig} os
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function authorizeRpc(kind, peer, method, os) {
  if (!peerMayConnect(kind, peer, os)) {
    return {
      ok: false,
      error: `permission denied: uid ${peer.uid} cannot use ${kind} socket`,
    }
  }
  if (kind === 'apps') {
    if (!isAppsMethod(method)) {
      return {
        ok: false,
        error: `permission denied: method ${method} not allowed on apps socket`,
      }
    }
    return { ok: true }
  }
  // admin socket: apps methods + admin-only
  if (isAppsMethod(method) || isAdminOnlyMethod(method)) return { ok: true }
  return {
    ok: false,
    error: `permission denied: unknown method ${method}`,
  }
}
