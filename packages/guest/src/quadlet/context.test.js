import { join } from 'node:path'

import {
  DEFAULT_REPO_DIR,
  DEFAULT_SEED_DIR,
  createContext,
  resolveInstanceRoot,
} from './context.js'
import { QuadletError } from './errors.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from './test/fixture.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet context', () => {
  test('resolveInstanceRoot: explicit root, QCTL_ROOT, walk-up; bad root dies', () => {
    const fx = makeQuadletInstance()
    try {
      expect(resolveInstanceRoot({ root: fx.root })).toBe(fx.root)
      expect(resolveInstanceRoot({ env: { QCTL_ROOT: fx.root } })).toBe(fx.root)

      const nested = join(fx.root, 'applications/web')
      expect(resolveInstanceRoot({ cwd: nested, env: {} })).toBe(fx.root)

      expect(() => resolveInstanceRoot({ root: fx.sysDir })).toThrow(QuadletError)
      expect(() => resolveInstanceRoot({ root: fx.sysDir })).toThrow(/not a qctl instance/)
      expect(() => resolveInstanceRoot({ cwd: fx.sysDir, env: {} })).toThrow(/no qctl instance/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('resolveInstanceRoot: QCTL_ROOT and DEFAULT_REPO_DIR', () => {
    expect(DEFAULT_REPO_DIR).toBe('/tank/rocky')
    const fx = makeQuadletInstance()
    try {
      expect(
        resolveInstanceRoot({
          cwd: fx.sysDir,
          env: { QCTL_ROOT: fx.root },
        }),
      ).toBe(fx.root)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('createContext defaults seedDir and uses injected log/print', () => {
    const fx = makeQuadletInstance()
    try {
      const { sys } = makeContext(fx)
      /** @type {string[]} */
      const logs = []
      /** @type {string[]} */
      const prints = []
      const ctx = createContext({
        root: fx.root,
        sys,
        baseEnv: { PATH: '/bin', QCTL_SEED_DIR: '/custom-seed' },
        log: (m) => logs.push(m),
        print: (m) => prints.push(m),
      })
      expect(ctx.root).toBe(fx.root)
      expect(ctx.seedDir).toBe('/custom-seed')
      ctx.log('hi')
      ctx.print('out')
      expect(logs).toEqual(['hi'])
      expect(prints).toEqual(['out'])

      const bare = createContext({ root: fx.root, sys, baseEnv: {} })
      expect(bare.seedDir).toBe(DEFAULT_SEED_DIR)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
