import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeFile } from '@qctl/shared/test-helpers'

import { MARKER_DIR } from './apps/index.js'
import { runEnable } from './enable.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from './test/fixture.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet enable', () => {
  test('enable renders units, shared nets for the engine, marker, and reloads', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      await runEnable(ctx, { app: 'web' })
      const rl = sys.paths('rootless')
      expect(readFileSync(join(rl.dest, 'web/web.container'), 'utf8')).toContain('2.0-dev')
      expect(existsSync(join(rl.dest, 'web/web.container.d/autostart.conf'))).toBe(true)
      expect(existsSync(join(rl.dest, 'shared.network'))).toBe(true)
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(true)
      expect(sys.lines()).toContain('systemctl:rootless daemon-reload')
      expect(out).toContain('engine=rootless owner=apps')
      expect(out).toContain('Start with: qctl quadlet start web')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('enable --no-install drops autostart + marker', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      await runEnable(ctx, { app: 'web' })
      await runEnable(ctx, { app: 'web', install: false })
      const rl = sys.paths('rootless')
      expect(existsSync(join(rl.dest, 'web/web.container.d/autostart.conf'))).toBe(false)
      expect(existsSync(join(rl.dest, MARKER_DIR, 'web'))).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('enable: unknown app / unresolved var die', async () => {
    const fx = makeQuadletInstance()
    try {
      await expect(runEnable(makeContext(fx).ctx, { app: 'ghost' })).rejects.toThrow(/unknown app/)
      writeFile(
        fx.root,
        'applications/proxy/proxy/proxy.container',
        '[Container]\nImage=${MISSING}\n',
      )
      await expect(runEnable(makeContext(fx).ctx, { app: 'proxy' })).rejects.toThrow(/unresolved/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
