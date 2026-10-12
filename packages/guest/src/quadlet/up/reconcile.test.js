import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { writeFile } from '@qctl/shared/test-helpers'

import { MARKER_DIR } from '../apps/index.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { runUp } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet up reconcile', () => {
  test('template change → will update / restart only that app', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      writeFile(fx.root, 'applications/web/.env.dev', 'VERSION=3.0\n')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toEqual(['will update web'])

      const { ctx, sys } = makeContext(fx)
      await runUp(ctx)
      expect(sys.lines().filter((l) => /^systemctl:\w+ (re)?start/.test(l))).toEqual([
        'systemctl:rootless start web.service',
      ])
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('orphan app (marker, no repo dir) is removed; dry-run plans it', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      rmSync(join(fx.root, 'applications/dbroot'), { recursive: true })
      // web still lists dbroot as companion; drop that too
      writeFile(fx.root, 'applications/web/app.yaml', 'engine: rootless\n')

      const d = makeContext(fx)
      await runUp(d.ctx, { dryRun: true })
      expect(d.out).toContain('will remove dbroot')

      const { ctx, sys } = makeContext(fx)
      await runUp(ctx)
      const rf = sys.paths('rootful')
      expect(existsSync(join(rf.dest, 'dbroot'))).toBe(false)
      expect(existsSync(join(rf.dest, MARKER_DIR, 'dbroot'))).toBe(false)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
