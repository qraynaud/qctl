import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import { supervisorRequest } from './client.js'
import { assertProxyAppName, runAppProxyRelease, runAppProxyStart } from './proxy.js'
import { startSupervisorServer } from './server.js'
import { clearAppReady, setAppReady } from './stamps.js'
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

describe('app proxy', () => {
  test('assertProxyAppName rejects empty / path-like', () => {
    expect(() => assertProxyAppName('')).toThrow(/invalid/)
    expect(() => assertProxyAppName('../x')).toThrow(/invalid/)
    expect(assertProxyAppName('web')).toBe('web')
  })

  test('start: ensure → notify → watch ends when stamp clears', async () => {
    const runDir = join(makeTempDir(), 'run')
    const notifies = /** @type {string[]} */ ([])
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: () => /** @type {PeerCred} */ ({ pid: 1, uid: 900, gid: 900 }),
      handlers: {
        ensure: (req) => {
          setAppReady(req.params.app, runDir)
          return {
            method: 'ensure',
            app: req.params.app,
            refs: 1,
            engine: 'rootful',
            started: true,
          }
        },
        release: (req) => {
          clearAppReady(req.params.app, runDir)
          return { method: 'release', app: req.params.app, refs: 0, stopped: true }
        },
      },
    })
    servers.push(server)

    const started = runAppProxyStart({
      app: 'web',
      runDir,
      sockPath: server.appsPath,
      exitProcess: false,
      readyTimeoutMs: 5_000,
      notify: async (state) => {
        notifies.push(state)
        return true
      },
      log: () => {},
    })

    // Let proxy reach watch, then drop ready (peer died).
    await new Promise((r) => setTimeout(r, 150))
    expect(notifies).toContain('READY=1')
    clearAppReady('web', runDir)

    const code = await started
    expect(code).toBe(1)
  })

  test('release calls supervisor release', async () => {
    const runDir = join(makeTempDir(), 'run')
    /** @type {string[]} */
    const released = []
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: () => /** @type {PeerCred} */ ({ pid: 1, uid: 0, gid: 0 }),
      handlers: {
        release: (req) => {
          released.push(req.params.app)
          return { method: 'release', app: req.params.app, refs: 0, stopped: true }
        },
      },
    })
    servers.push(server)

    const code = await runAppProxyRelease({
      app: 'db',
      runDir,
      sockPath: server.appsPath,
      exitProcess: false,
      log: () => {},
    })
    expect(code).toBe(0)
    expect(released).toEqual(['db'])
  })

  test('status reflects stamps', async () => {
    const runDir = join(makeTempDir(), 'run')
    const server = await startSupervisorServer({
      osConfig: os(),
      runDir,
      chownSockets: false,
      getPeerCred: () => /** @type {PeerCred} */ ({ pid: 1, uid: 900, gid: 900 }),
    })
    servers.push(server)

    const cold = await supervisorRequest(server.appsPath, {
      method: 'status',
      params: { app: 'web' },
    })
    expect(cold).toEqual({
      ok: true,
      result: { method: 'status', app: 'web', ready: false, failed: false },
    })

    setAppReady('web', runDir)
    const hot = await supervisorRequest(server.appsPath, {
      method: 'status',
      params: { app: 'web' },
    })
    expect(hot.ok && hot.result && 'ready' in hot.result && hot.result.ready).toBe(true)
  })
})
