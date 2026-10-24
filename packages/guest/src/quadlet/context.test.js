import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SEED_DIR, createContext, resolveInstanceRoot } from './context.js'
import { QuadletError } from './errors.js'
import { cleanupQuadletFixture, makeContext, makeQuadletInstance } from './test/fixture.js'
import { describe, expect, test } from 'bun:test'

/**
 * @param {string} path
 * @param {string} root
 */
function writeOsConfig(path, root) {
  writeFileSync(
    path,
    JSON.stringify({
      env: 'dev',
      root,
      repo: { vcs: 'hg' },
      quadletUser: 'apps',
      apps: {
        username: 'apps',
        uid: 1000,
        gid: 1000,
        subuid: { start: 1, count: 1 },
        subgid: { start: 1, count: 1 },
      },
      timezone: 'UTC',
      profile: 'appliance',
    }),
  )
}

describe('quadlet context', () => {
  test('resolveInstanceRoot: OS config only; missing/invalid dies', () => {
    const fx = makeQuadletInstance()
    try {
      const osPath = join(fx.sysDir, 'os-config.json')
      writeOsConfig(osPath, fx.root)
      expect(resolveInstanceRoot({ osConfigPath: osPath })).toBe(fx.root)

      expect(() => resolveInstanceRoot({ osConfigPath: join(fx.sysDir, 'missing.json') })).toThrow(
        QuadletError,
      )
      expect(() => resolveInstanceRoot({ osConfigPath: join(fx.sysDir, 'missing.json') })).toThrow(
        /missing instance root/,
      )

      writeOsConfig(osPath, fx.sysDir)
      expect(() => resolveInstanceRoot({ osConfigPath: osPath })).toThrow(/not a qctl instance/)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })

  test('createContext defaults seedDir (no QCTL_SEED_DIR)', () => {
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
        baseEnv: { PATH: '/bin', QCTL_SEED_DIR: '/ignored' },
        seedDir: '/custom-seed',
        log: (m) => logs.push(m),
        print: (m) => prints.push(m),
      })
      expect(ctx.root).toBe(fx.root)
      expect(ctx.seedDir).toBe('/custom-seed')
      ctx.log('hi')
      ctx.print('out')
      expect(logs).toEqual(['hi'])
      expect(prints).toEqual(['out'])

      const bare = createContext({ root: fx.root, sys, baseEnv: { QCTL_SEED_DIR: '/ignored' } })
      expect(bare.seedDir).toBe(DEFAULT_SEED_DIR)
    } finally {
      cleanupQuadletFixture(fx)
    }
  })
})
