/**
 * End-to-end `runUp` orchestration (markers → networks → reconcile → restart).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MARKER_DIR } from '../apps/index.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { runUp } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet up', () => {
  test('dry-run: plans adds, installs nothing', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      await runUp(ctx, { dryRun: true })
      expect(out.filter((l) => l.startsWith('will add'))).toEqual([
        'will add dbroot',
        'will add proxy',
        'will add web',
      ])
      // new shared networks count as "update" (nothing installed yet), like the old bash
      expect(out).toContain('will update shared.network')
      expect(out).toContain('will update lan.network')
      expect(sys.calls.filter((c) => c.kind !== 'chown')).toEqual([])
      expect(existsSync(sys.paths('rootless').dest)).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('first run installs units, runtime env, autostart, shared networks, markers; restarts in dep order', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      await runUp(ctx)
      const rl = sys.paths('rootless')
      const rf = sys.paths('rootful')

      const web = readFileSync(join(rl.dest, 'web/web.container'), 'utf8')
      expect(web).toContain('Image=img/web:2.0-dev')
      expect(web).not.toContain('${')
      expect(web).toContain('Requires=proxy.service')
      expect(web).not.toContain('qctl-app@proxy.service')
      expect(readFileSync(join(rl.dest, 'web/web.container.d/autostart.conf'), 'utf8')).toContain(
        'WantedBy=default.target',
      )
      expect(
        readFileSync(join(rf.dest, 'dbroot/dbroot.container.d/autostart.conf'), 'utf8'),
      ).toContain('WantedBy=multi-user.target')
      expect(readFileSync(join(rl.dest, 'web/.env'), 'utf8')).toBe('A=2\nB=x.localhost\nC=3\n')
      expect(existsSync(join(rl.dest, 'web.network'))).toBe(true) // package-root shared
      expect(existsSync(join(rl.dest, 'web/web.network'))).toBe(true) // symlink into unit dir
      // shared nets land on their classified engine only
      expect(existsSync(join(rl.dest, 'shared.network'))).toBe(true)
      expect(existsSync(join(rf.dest, 'shared.network'))).toBe(false)
      expect(readFileSync(join(rf.dest, 'lan.network'), 'utf8')).toContain('parent=eth9')
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(true)
      expect(readFileSync(join(rf.dest, MARKER_DIR, 'dbroot'), 'utf8')).toContain('engine=rootful')

      // reload then restart: deps (proxy, dbroot) before web
      const lines = sys.lines()
      const reload = lines.indexOf('systemctl:rootless daemon-reload')
      const proxy = lines.indexOf('systemctl:rootless start proxy.service')
      const web_ = lines.indexOf('systemctl:rootless start web.service')
      expect(reload).toBeGreaterThan(-1)
      expect(proxy).toBeGreaterThan(reload)
      expect(web_).toBeGreaterThan(proxy)
      expect(lines).toContain('systemctl:rootful daemon-reload')
      expect(lines).toContain('systemctl:rootful start dbroot.service')
      expect(out.at(-1)).toBe('quadlet: done (restarted: dbroot proxy web)')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('second run is idempotent: no restarts; dry-run says nothing to do', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      const { ctx, sys, out } = makeContext(fx)
      await runUp(ctx)
      expect(sys.lines().filter((l) => /start|restart|daemon-reload/.test(l))).toEqual([])
      expect(out.at(-1)).toBe('quadlet: done (no restarts)')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toEqual(['nothing to do'])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
