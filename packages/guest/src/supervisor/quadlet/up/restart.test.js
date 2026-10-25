import { writeFile } from '@qctl/shared/test-helpers'

import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from '../test/fixture.js'
import { runUp } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet up restart', () => {
  test('active unit is restarted, not started', async () => {
    const fx = makeQuadletInstance()
    try {
      await runUp(makeContext(fx).ctx)
      writeFile(fx.root, 'applications/proxy/.env.dev', 'VERSION=9\n')
      const { ctx, sys } = makeContext(fx, (c) =>
        c.line.startsWith('systemctl:rootless is-active') ? { status: 0 } : undefined,
      )
      await runUp(ctx)
      expect(sys.lines()).toContain('systemctl:rootless restart proxy.service')
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
