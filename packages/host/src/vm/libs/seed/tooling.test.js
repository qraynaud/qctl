import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../../../init.js'
import { resetRepoRootCache } from '../../../lib/paths.js'
import { embedGuestTooling } from './tooling.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origCwd = process.cwd()
const origDist = process.env.QCTL_GUEST_DIST
const origVw = process.env.QCTL_VW_PLUGIN
const origCache = process.env.QCTL_CACHE_HOME
const origData = process.env.QCTL_DATA_HOME
/** @type {string[]} */
const temps = []

beforeEach(() => {
  const base = makeTempDir()
  temps.push(base)
  process.env.QCTL_CACHE_HOME = join(base, 'cache')
  process.env.QCTL_DATA_HOME = join(base, 'data')
})

afterEach(() => {
  process.chdir(origCwd)
  resetRepoRootCache()
  if (origDist === undefined) delete process.env.QCTL_GUEST_DIST
  else process.env.QCTL_GUEST_DIST = origDist
  if (origVw === undefined) delete process.env.QCTL_VW_PLUGIN
  else process.env.QCTL_VW_PLUGIN = origVw
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  if (origData === undefined) delete process.env.QCTL_DATA_HOME
  else process.env.QCTL_DATA_HOME = origData
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('embedGuestTooling', () => {
  test('copies compiled guest binaries when present', async () => {
    const base = makeTempDir()
    temps.push(base)
    const root = realpathSync(initInstance(join(base, 'inst')).root)
    process.chdir(root)

    const dist = join(base, 'dist')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'qctl-guest'), '#!/bin/sh\n')
    writeFileSync(join(dist, 'qctl-platform-rocky.mjs'), 'export default {}\n')
    process.env.QCTL_GUEST_DIST = dist

    const out = join(base, 'cidata')
    mkdirSync(out, { recursive: true })
    const copied = await embedGuestTooling(out)
    expect(copied).toEqual(['qctl-guest'])
    expect(existsSync(join(out, 'qctl-guest', 'qctl-guest'))).toBe(true)
    expect(existsSync(join(out, 'qctl-guest', 'qctl-platform-rocky.mjs'))).toBe(true)
    expect(existsSync(join(out, 'qctl-guest', 'qctl-platform-rocky'))).toBe(false)
    expect(existsSync(join(out, 'qctl-guest', 'varlock', 'plugins-cache'))).toBe(false)
  })

  test('stages varlock-local-encrypt (no bootstrap graph)', async () => {
    const base = makeTempDir()
    temps.push(base)
    const root = realpathSync(initInstance(join(base, 'inst')).root)
    process.chdir(root)

    const repo = join(base, 'qctlrepo')
    const dist = join(repo, 'dist')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'qctl-guest'), '#!/bin/sh\n')
    writeFileSync(join(dist, 'qctl-platform-rocky.mjs'), 'export default {}\n')
    writeFileSync(join(dist, 'varlock-local-encrypt'), '#!/bin/sh\n')
    process.env.QCTL_GUEST_DIST = dist

    const out = join(base, 'cidata')
    mkdirSync(out, { recursive: true })
    await embedGuestTooling(out)
    for (const f of ['qctl-guest', 'qctl-platform-rocky.mjs', 'varlock-local-encrypt']) {
      expect(existsSync(join(out, 'qctl-guest', f))).toBe(true)
    }
    expect(existsSync(join(out, 'qctl-guest', 'qctl-platform-rocky'))).toBe(false)
    expect(existsSync(join(out, 'qctl-guest', 'bootstrap'))).toBe(false)
    expect(existsSync(join(root, 'provision', '.env.schema'))).toBe(true)
  })

  test('without dist binaries still creates qctl-guest dir', async () => {
    const base = makeTempDir()
    temps.push(base)
    const root = realpathSync(initInstance(join(base, 'inst')).root)
    process.chdir(root)
    process.env.QCTL_GUEST_DIST = join(base, 'nope')
    const out = join(base, 'cidata')
    mkdirSync(out, { recursive: true })
    expect(await embedGuestTooling(out)).toEqual([])
    expect(existsSync(join(out, 'qctl-guest', 'qctl-guest'))).toBe(false)
    expect(existsSync(join(out, 'qctl-guest', 'bootstrap'))).toBe(false)
  })
})
