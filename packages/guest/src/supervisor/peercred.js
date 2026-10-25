/**
 * SO_PEERCRED for unix stream sockets (Linux) via libc getsockopt.
 */
import { FFIType, dlopen, ptr } from 'bun:ffi'

/** @import { Socket } from 'node:net' */

/** @typedef {{ pid: number, uid: number, gid: number }} PeerCred */

const SOL_SOCKET = 1
const SO_PEERCRED = 17

const libc = dlopen('libc.so.6', {
  getsockopt: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
})

/**
 * Read peer credentials from an accepted unix stream socket.
 * @param {Socket | { _handle?: { fd?: number }, fd?: number }} socket
 * @returns {PeerCred}
 */
export function getPeerCred(socket) {
  const raw = /** @type {{ _handle?: { fd?: number }, fd?: number }} */ (socket)
  const fd = raw._handle?.fd ?? raw.fd
  if (typeof fd !== 'number' || fd < 0) {
    throw new Error('qctl-supervisor: cannot read peer credentials (missing socket fd)')
  }
  const ucred = new Uint32Array(3)
  const len = new Uint32Array([12])
  const r = libc.symbols.getsockopt(fd, SOL_SOCKET, SO_PEERCRED, ptr(ucred), ptr(len))
  if (r !== 0) {
    throw new Error(`qctl-supervisor: SO_PEERCRED failed (getsockopt=${r})`)
  }
  return { pid: ucred[0] ?? 0, uid: ucred[1] ?? 0, gid: ucred[2] ?? 0 }
}
