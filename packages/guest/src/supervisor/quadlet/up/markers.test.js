import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { writeFile } from '@qctl/shared/test-helpers'

import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { runUp } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet up markers', () => {
  test('filtered up: app + companions only; unknown app dies', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      await runUp(ctx, { app: 'proxy' })
      expect(existsSync(join(sys.paths('rootless').dest, 'web'))).toBe(false)
      expect(existsSync(join(sys.paths('rootless').dest, 'proxy/proxy.container'))).toBe(true)
      // proxy references shared.network → installed; lan (rootful, unreferenced) is not
      expect(existsSync(join(sys.paths('rootless').dest, 'shared.network'))).toBe(true)
      expect(existsSync(join(sys.paths('rootful').dest, 'lan.network'))).toBe(false)

      const { ctx: c2 } = makeContext(fx)
      await expect(runUp(c2, { app: 'ghost' })).rejects.toThrow(/unknown app 'ghost'/)

      const { ctx: c3, sys: s3 } = makeContext(fx)
      await runUp(c3, { app: 'applications/web' })
      // companion unit installed with the app
      expect(existsSync(join(s3.paths('rootful').dest, 'dbroot/dbroot.container'))).toBe(true)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('filtered up: multiple apps in one pass', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys } = makeContext(fx)
      await runUp(ctx, { apps: ['proxy', 'dbroot'] })
      expect(existsSync(join(sys.paths('rootless').dest, 'proxy/proxy.container'))).toBe(true)
      expect(existsSync(join(sys.paths('rootful').dest, 'dbroot/dbroot.container'))).toBe(true)
      expect(existsSync(join(sys.paths('rootless').dest, 'web/web.container'))).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('seeds markers from installed containers when none exist', async () => {
    const fx = makeQuadletInstance()
    try {
      const { ctx, sys, out } = makeContext(fx)
      const rl = sys.paths('rootless')
      writeFile(rl.dest, 'proxy/proxy.container', 'stale\n')
      await runUp(ctx)
      expect(out).toContain('quadlet: seeded enabled marker for proxy (rootless)')
      // seeded → not "add" (marker existed), but content differs → updated + restarted
      expect(out.some((l) => l.startsWith('quadlet: add proxy'))).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
