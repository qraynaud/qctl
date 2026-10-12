import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { isQctlSourceRoot, tryGetLocalGuestDist, tryGetQctlSourceRoot } from './qctl-source.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('qctl-source', () => {
  test('isQctlSourceRoot requires compile.js + packages/host', () => {
    const base = makeTempDir()
    temps.push(base)
    expect(isQctlSourceRoot(base)).toBe(false)
    writeFileSync(join(base, 'package.json'), '{}\n')
    mkdirSync(join(base, 'ci'), { recursive: true })
    writeFileSync(join(base, 'ci', 'compile.js'), '')
    mkdirSync(join(base, 'packages', 'host'), { recursive: true })
    expect(isQctlSourceRoot(base)).toBe(true)
  })

  test('tryGetQctlSourceRoot finds this checkout when running from source', () => {
    const root = tryGetQctlSourceRoot()
    expect(root).toBeTruthy()
    expect(isQctlSourceRoot(/** @type {string} */ (root))).toBe(true)
    expect(tryGetLocalGuestDist()).toBe(join(/** @type {string} */ (root), 'dist'))
  })
})
