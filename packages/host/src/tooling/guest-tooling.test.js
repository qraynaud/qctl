import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../shared/src/test-helpers.js'
import { ensureGuestTooling } from './guest-tooling.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origDist = process.env.QCTL_GUEST_DIST
const origCache = process.env.QCTL_CACHE_HOME
/** @type {string[]} */
const temps = []

beforeEach(() => {
  const base = makeTempDir()
  temps.push(base)
  process.env.QCTL_CACHE_HOME = join(base, 'cache')
})

afterEach(() => {
  if (origDist === undefined) delete process.env.QCTL_GUEST_DIST
  else process.env.QCTL_GUEST_DIST = origDist
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('ensureGuestTooling', () => {
  test('uses QCTL_GUEST_DIST when complete', async () => {
    const base = temps[0]
    const dist = join(/** @type {string} */ (base), 'dist')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'qctl-guest'), '#!/bin/sh\n')
    writeFileSync(join(dist, 'qctl-platform-rocky.mjs'), 'export default {}\n')
    process.env.QCTL_GUEST_DIST = dist

    const r = await ensureGuestTooling({ required: true })
    expect(r?.sourceLabel).toBe(dist)
    expect(r?.guestPath).toBe(join(dist, 'qctl-guest'))
    expect(r?.platformModulePath).toBe(join(dist, 'qctl-platform-rocky.mjs'))
  })

  test('returns null for incomplete QCTL_GUEST_DIST when not required', async () => {
    process.env.QCTL_GUEST_DIST = join(/** @type {string} */ (temps[0]), 'missing')
    const r = await ensureGuestTooling({ required: false })
    expect(r).toBeNull()
  })
})
