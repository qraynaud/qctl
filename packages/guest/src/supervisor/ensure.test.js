import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, writeMinimalInstance } from '@qctl/shared/test-helpers'

import { createContext } from '../quadlet/context.js'
import { createFakeSystem } from '../quadlet/test/fake-system.js'
import { createAppHolds } from './ensure.js'
import { isAppFailed, isAppReady } from './stamps.js'
import { describe, expect, test } from 'bun:test'

/**
 * @param {string} root
 * @param {string} app
 * @param {'rootless' | 'rootful'} engine
 */
function writeApp(root, app, engine) {
  const dir = join(root, 'applications', app)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'app.yaml'), `engine: ${engine}\n`)
  writeFileSync(
    join(dir, `${app}.container`),
    '[Container]\nImage=docker.io/library/alpine:latest\n',
  )
}

describe('createAppHolds', () => {
  test('ensure starts units once; second hold bumps refs; release stops at zero', async () => {
    const dir = makeTempDir()
    const root = join(dir, 'instance')
    writeMinimalInstance(root, { withEnvRefs: false, withSchema: false, withOverlay: false })
    writeApp(root, 'web', 'rootful')
    const runDir = join(dir, 'run')

    /** @type {Set<string>} */
    const active = new Set()
    const sys = createFakeSystem({
      dir: join(dir, 'sys'),
      respond: (call) => {
        if (call.kind !== 'systemctl') return
        const verb = call.args[0]
        if (verb === 'start') {
          active.add(call.args[1])
          return { status: 0 }
        }
        if (verb === 'stop') {
          active.delete(call.args[1])
          return { status: 0 }
        }
        if (verb === 'is-active') {
          const svc = call.args.includes('--quiet') ? call.args[2] : call.args[1]
          return { status: active.has(svc) ? 0 : 3 }
        }
        if (verb === 'is-failed') return { status: 1 }
        if (verb === 'reset-failed') return { status: 0 }
      },
    })

    const ctx = createContext({
      root,
      sys,
      osConfig: {
        env: 'dev',
        root,
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
      },
      log: () => {},
    })

    const holds = createAppHolds({
      runDir,
      ctx,
      readyTimeoutMs: 2_000,
      pollMs: 20,
      monitorPollMs: 60_000,
      log: () => {},
    })

    const a = await holds.ensure('web')
    expect(a).toMatchObject({
      method: 'ensure',
      app: 'web',
      refs: 1,
      engine: 'rootful',
      started: true,
    })
    expect(isAppReady('web', runDir)).toBe(true)
    expect(sys.lines().some((l) => l.includes('systemctl:rootful start web.service'))).toBe(true)

    const b = await holds.ensure('web')
    expect(b).toMatchObject({ refs: 2, started: false })
    const starts = sys.lines().filter((l) => l.includes('start web.service'))
    expect(starts).toHaveLength(1)

    const r1 = await holds.release('web')
    expect(r1).toMatchObject({ refs: 1, stopped: false })
    expect(isAppReady('web', runDir)).toBe(true)
    expect(sys.lines().some((l) => l.includes('stop web.service'))).toBe(false)

    const r2 = await holds.release('web')
    expect(r2).toMatchObject({ refs: 0, stopped: true })
    expect(isAppReady('web', runDir)).toBe(false)
    expect(sys.lines().some((l) => l.includes('systemctl:rootful stop web.service'))).toBe(true)
  })

  test('ensure failure sets failed stamp and rolls back refs', async () => {
    const dir = makeTempDir()
    const root = join(dir, 'instance')
    writeMinimalInstance(root, { withEnvRefs: false, withSchema: false, withOverlay: false })
    writeApp(root, 'web', 'rootless')
    const runDir = join(dir, 'run')

    const sys = createFakeSystem({
      dir: join(dir, 'sys'),
      respond: (call) => {
        if (call.kind === 'systemctl' && call.args[0] === 'start') return { status: 1 }
      },
    })

    const ctx = createContext({
      root,
      sys,
      log: () => {},
    })

    const holds = createAppHolds({ runDir, ctx, log: () => {} })
    await expect(holds.ensure('web')).rejects.toThrow(/start web.service failed/)
    expect(holds.snapshotRefs().get('web') ?? 0).toBe(0)
    expect(isAppFailed('web', runDir)).toBe(true)
    expect(sys.lines().some((l) => l.includes('bus:rootless'))).toBe(true)
  })
})
