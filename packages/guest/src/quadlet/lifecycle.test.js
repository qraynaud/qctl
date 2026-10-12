import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { MARKER_DIR } from './apps/index.js'
import { formatTable, runDown, runPs, runRestart, runStartStop } from './lifecycle.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from './test/fixture.js'
import { runUp } from './up.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet lifecycle', () => {
  test("start/stop/restart address the app's engine + services", async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const a = makeContext(fx)
      runStartStop(a.ctx, 'start', 'web')
      expect(a.sys.lines()).toContain('systemctl:rootless start web.service')

      const b = makeContext(fx)
      runStartStop(b.ctx, 'stop', 'dbroot')
      expect(b.sys.lines()).toContain('systemctl:rootful stop dbroot.service')

      const c = makeContext(fx)
      runRestart(c.ctx, 'web')
      expect(c.sys.lines()).toContain('systemctl:rootless reset-failed web.service')
      expect(c.sys.lines()).toContain('systemctl:rootless start web.service') // fake: not active

      const d = makeContext(fx, (call) =>
        call.line.includes('is-active') ? { status: 0 } : undefined,
      )
      runRestart(d.ctx, 'web')
      expect(d.sys.lines()).toContain('systemctl:rootless restart web.service')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('start fails when systemctl fails; unknown app dies', () => {
    const fx = makeQuadletInstance()
    try {
      expect(() => runStartStop(makeContext(fx).ctx, 'start', 'ghost')).toThrow(
        /not installed and not in applications/,
      )
      const bad = makeContext(fx, (c) => (c.line.includes(' start ') ? { status: 5 } : undefined))
      expect(() => runStartStop(bad.ctx, 'start', 'web')).toThrow(/failed \(exit 5\)/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('down removes installed files + marker and reloads', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const { ctx, sys } = makeContext(fx)
      runDown(ctx, 'web')
      const rl = sys.paths('rootless')
      expect(existsSync(join(rl.dest, 'web'))).toBe(false)
      expect(existsSync(join(rl.dest, 'web.network'))).toBe(false)
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(false)
      expect(existsSync(join(rl.dest, 'proxy/proxy.container'))).toBe(true)
      expect(sys.lines()).toContain('systemctl:rootless stop web.service')
      expect(sys.lines()).toContain('systemctl:rootless daemon-reload')
      expect(() => runDown(makeContext(fx).ctx, 'nonexistent')).toThrow(
        /not installed and not in repo/,
      )
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('ps: container status from podman, else systemd state, else not-installed', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const { ctx, out } = makeContext(fx, (c) => {
        if (c.line.startsWith('podman:rootless container inspect proxy'))
          return { status: 0, stdout: 'abc123\n' }
        if (c.line.includes('--format {{.Status}}')) return { stdout: 'Up 5 minutes (healthy)\n' }
        if (c.line.includes('--format {{.Image}}')) return { stdout: 'img/proxy:1.0\n' }
        if (c.line.includes('is-active')) return { stdout: 'inactive\n', status: 3 }
        if (c.line.includes('container inspect')) return { status: 125 }
        return undefined
      })
      runPs(ctx)
      expect(out[0]).toMatch(/^ENGINE\s+NAMES\s+STATUS\s+IMAGE$/)
      expect(
        out.some((l) => /rootless\s+proxy\s+Up 5 minutes \(healthy\)\s+img\/proxy:1.0/.test(l)),
      ).toBe(true)
      expect(out.some((l) => /rootless\s+web\s+stopped/.test(l))).toBe(true)
      expect(out.some((l) => /rootful\s+dbroot\s+stopped/.test(l))).toBe(true)

      rmSync(join(makeContext(fx).sys.paths('rootless').dest, 'web/web.container'))
      const one = makeContext(fx, (c) =>
        c.line.includes('container inspect') ? { status: 125 } : undefined,
      )
      runPs(one.ctx, 'web')
      expect(one.out.some((l) => /rootless\s+web\s+not-installed/.test(l))).toBe(true)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('formatTable aligns columns', () => {
    expect(
      formatTable([
        ['A', 'BB'],
        ['CCC', 'D'],
      ]),
    ).toEqual(['A    BB', 'CCC  D'])
  })
})
