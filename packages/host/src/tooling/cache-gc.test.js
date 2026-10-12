import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { CACHE_MAX_AGE_MS, gcQctlCache, touchPath } from './cache-gc.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origCache = process.env.QCTL_CACHE_HOME
/** @type {string[]} */
const temps = []

beforeEach(() => {
  const base = makeTempDir()
  temps.push(base)
  process.env.QCTL_CACHE_HOME = join(base, 'cache')
})

afterEach(() => {
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('cache-gc', () => {
  test('removes stale files and empty dirs; keeps fresh', () => {
    const root = /** @type {string} */ (process.env.QCTL_CACHE_HOME)
    const seedDir = join(root, 'repos', 'abcd', 'seed', 'dev')
    mkdirSync(seedDir, { recursive: true })
    const stale = join(seedDir, 'old.iso')
    const fresh = join(seedDir, 'new.iso')
    writeFileSync(stale, 'x')
    writeFileSync(fresh, 'y')
    touchPath(fresh)

    const now = Date.now()
    utimesSync(
      stale,
      new Date(now - CACHE_MAX_AGE_MS - 1000),
      new Date(now - CACHE_MAX_AGE_MS - 1000),
    )

    const { removed } = gcQctlCache({ now, maxAgeMs: CACHE_MAX_AGE_MS })
    expect(removed).toContain(stale)
    expect(removed).not.toContain(fresh)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(stale)).toBe(false)
  })
})
