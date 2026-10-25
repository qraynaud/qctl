import { authorizeRpc, peerMayConnect } from './acl.js'
import { describe, expect, test } from 'bun:test'

/** @import { OsConfig } from '@qctl/shared' */

/** @returns {OsConfig} */
function os() {
  return {
    env: 'dev',
    root: '/tank/rocky',
    repo: { vcs: 'hg' },
    quadletUser: 'apps',
    apps: {
      username: 'apps',
      uid: 900,
      gid: 900,
      subuid: { start: 1, count: 1 },
      subgid: { start: 1, count: 1 },
    },
    admin: { username: 'admin', uid: 1000, gid: 1000 },
    timezone: 'UTC',
    profile: 'appliance',
  }
}

describe('supervisor acl', () => {
  test('peerMayConnect: root on both; apps/admin only their sockets', () => {
    const cfg = os()
    expect(peerMayConnect('apps', { pid: 1, uid: 0, gid: 0 }, cfg)).toBe(true)
    expect(peerMayConnect('admin', { pid: 1, uid: 0, gid: 0 }, cfg)).toBe(true)
    expect(peerMayConnect('apps', { pid: 1, uid: 900, gid: 900 }, cfg)).toBe(true)
    expect(peerMayConnect('admin', { pid: 1, uid: 900, gid: 900 }, cfg)).toBe(false)
    expect(peerMayConnect('admin', { pid: 1, uid: 1000, gid: 1000 }, cfg)).toBe(true)
    expect(peerMayConnect('apps', { pid: 1, uid: 1000, gid: 1000 }, cfg)).toBe(false)
    expect(peerMayConnect('apps', { pid: 1, uid: 42, gid: 42 }, cfg)).toBe(false)
  })

  test('authorizeRpc: apps methods on apps sock; quadlet denied on apps', () => {
    const cfg = os()
    const appsPeer = { pid: 1, uid: 900, gid: 900 }
    expect(authorizeRpc('apps', appsPeer, 'ensure', cfg).ok).toBe(true)
    const noQuadlet = authorizeRpc('apps', appsPeer, 'quadlet', cfg)
    expect(noQuadlet.ok).toBe(false)
    if (!noQuadlet.ok) expect(noQuadlet.error).toMatch(/not allowed on apps/)
  })

  test('authorizeRpc: admin may quadlet; random uid denied', () => {
    const cfg = os()
    const adminPeer = { pid: 1, uid: 1000, gid: 1000 }
    expect(authorizeRpc('admin', adminPeer, 'quadlet', cfg).ok).toBe(true)
    expect(authorizeRpc('admin', adminPeer, 'ensure', cfg).ok).toBe(true)
    const denied = authorizeRpc('admin', { pid: 1, uid: 42, gid: 42 }, 'quadlet', cfg)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toMatch(/uid 42/)
  })
})
