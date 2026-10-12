import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../../../init.js'
import { getSeed, repoHash, resetRepoRootCache } from '../../../lib/paths.js'
import { ensureSeed, readExistingInstanceId, resolveSeedPaths } from './iso.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origCwd = process.cwd()
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
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  if (origData === undefined) delete process.env.QCTL_DATA_HOME
  else process.env.QCTL_DATA_HOME = origData
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('resolveSeedPaths', () => {
  test('is under XDG cache repos/<hash>/seed', () => {
    const base = makeTempDir()
    temps.push(base)
    const root = realpathSync(initInstance(join(base, 'inst')).root)
    process.chdir(root)
    const seedRoot = getSeed()
    const cacheHome = /** @type {string} */ (process.env.QCTL_CACHE_HOME)
    expect(seedRoot).toBe(join(cacheHome, 'repos', repoHash(root), 'seed'))
    const p = resolveSeedPaths('appliance', 'dev')
    expect(p.isoPath).toBe(join(seedRoot, 'dev', 'nocloud.iso'))
    expect(p.instanceIdPath).toBe(join(seedRoot, 'dev', 'instance-id'))
    const t = resolveSeedPaths('init-tank', 'dev')
    expect(t.isoPath).toBe(join(seedRoot, 'dev', 'init-tank', 'nocloud.iso'))
  })
})

describe('ensureSeed', () => {
  test('prefers ISO over legacy FAT img', async () => {
    const base = makeTempDir()
    temps.push(base)
    const isoPath = join(base, 'nocloud.iso')
    const imgPath = join(base, 'cidata.img')
    writeFileSync(isoPath, 'iso')
    writeFileSync(imgPath, 'img')
    const got = await ensureSeed({ isoPath, imgPath })
    expect(got).toEqual({ path: isoPath, format: 'raw', device: 'cdrom' })
  })

  test('falls back to legacy FAT img', async () => {
    const base = makeTempDir()
    temps.push(base)
    const imgPath = join(base, 'cidata.img')
    writeFileSync(imgPath, 'img')
    const got = await ensureSeed({ isoPath: join(base, 'missing.iso'), imgPath })
    expect(got).toEqual({ path: imgPath, format: 'raw', device: 'disk' })
  })
})

describe('readExistingInstanceId', () => {
  test('returns trimmed id or null', () => {
    const base = makeTempDir()
    temps.push(base)
    mkdirSync(base, { recursive: true })
    const idPath = join(base, 'instance-id')
    expect(readExistingInstanceId(idPath)).toBe(null)
    writeFileSync(idPath, '  rocky-dev\n')
    expect(readExistingInstanceId(idPath)).toBe('rocky-dev')
  })
})
