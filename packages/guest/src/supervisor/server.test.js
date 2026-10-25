import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import {
  SupervisorUnavailableError,
  supervisorQuadletRequest,
  supervisorRequest,
} from './client.js'
import { startSupervisorServer } from './server.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { OsConfig } from '@qctl/shared' */
/** @import { PeerCred } from './peercred.js' */

/** @type {Awaited<ReturnType<typeof startSupervisorServer>>[]} */
const servers = []

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()
    if (s) await s.close()
  }
})

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

/**
 * @param {PeerCred} peer
 */
function fixedPeer(peer) {
  return () => peer
}

describe('supervisor server + client', () => {
  test('apps uid may ensure; denied quadlet on apps sock', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 900, gid: 900 }),
    })
    servers.push(server)

    const ok = await supervisorRequest(server.appsPath, {
      id: '1',
      method: 'ensure',
      params: { app: 'web' },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.result).toMatchObject({
        method: 'ensure',
        app: 'web',
        refs: 1,
        engine: 'rootful',
        started: false,
      })
    }

    const denied = await supervisorRequest(server.appsPath, {
      id: '2',
      method: 'quadlet',
      params: { op: 'ps' },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toMatch(/not allowed on apps/)
  })

  test('admin uid may quadlet on admin sock; apps uid denied on admin sock', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 1000, gid: 1000 }),
    })
    servers.push(server)

    const ok = await supervisorRequest(server.adminPath, {
      method: 'quadlet',
      params: { op: 'ps' },
    })
    expect(ok.ok).toBe(true)

    await server.close()
    servers.pop()

    const server2 = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 900, gid: 900 }),
    })
    servers.push(server2)
    const denied = await supervisorRequest(server2.adminPath, {
      method: 'ensure',
      params: { app: 'web' },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toMatch(/uid 900/)
  })

  test('random uid denied on apps sock', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 42, gid: 42 }),
    })
    servers.push(server)
    const denied = await supervisorRequest(server.appsPath, {
      method: 'ensure',
      params: { app: 'web' },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toMatch(/uid 42/)
  })

  test('client: missing socket → SupervisorUnavailableError', async () => {
    const missing = join(makeTempDir(), 'nope.sock')
    await expect(
      supervisorRequest(missing, { method: 'status', params: { app: 'web' } }),
    ).rejects.toBeInstanceOf(SupervisorUnavailableError)
    await expect(
      supervisorRequest(missing, { method: 'status', params: { app: 'web' } }),
    ).rejects.toThrow(/qctl-supervisor not running/)
  })

  test('root uid allowed on apps sock', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 0, gid: 0 }),
    })
    servers.push(server)
    const ok = await supervisorRequest(server.appsPath, {
      method: 'status',
      params: { app: 'web' },
    })
    expect(ok.ok).toBe(true)
  })

  test('admin uid denied on apps sock (even for ensure)', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 1000, gid: 1000 }),
    })
    servers.push(server)
    const denied = await supervisorRequest(server.appsPath, {
      method: 'ensure',
      params: { app: 'web' },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toMatch(/uid 1000/)
  })

  test('quadlet streams stdio then exitCode on admin sock', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: fixedPeer({ pid: 1, uid: 1000, gid: 1000 }),
      handlers: {
        quadlet: async (_req, ctx) => {
          ctx.writeStdout?.('out-line\n')
          ctx.writeStderr?.('err-line\n')
          return { method: 'quadlet', exitCode: 7 }
        },
      },
    })
    servers.push(server)

    /** @type {string[]} */
    const out = []
    /** @type {string[]} */
    const err = []
    const res = await supervisorQuadletRequest(
      server.adminPath,
      { method: 'quadlet', params: { op: 'ps' } },
      {
        onStdout: (d) => out.push(d),
        onStderr: (d) => err.push(d),
      },
    )
    expect(out).toEqual(['out-line\n'])
    expect(err).toEqual(['err-line\n'])
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.result).toEqual({ method: 'quadlet', exitCode: 7 })
  })
})
