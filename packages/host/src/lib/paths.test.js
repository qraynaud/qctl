import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../init.js'
import {
  DATA_COUNT,
  SPECIAL_COUNT,
  getCacheHome,
  getCloud,
  getDataHome,
  getImages,
  getProvision,
  getRepoRoot,
  getSeed,
  getTooling,
  getVms,
  repoHash,
  resetRepoRootCache,
  resetSeedKitRoot,
  setSeedKitRoot,
  tryGetRepoRoot,
} from './paths.js'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const origCwd = process.cwd()
const origSeedEnv = process.env.QCTL_ROCKY_SEED
const origCache = process.env.QCTL_CACHE_HOME
const origData = process.env.QCTL_DATA_HOME
/** @type {string[]} */
const temps = []

beforeEach(() => {
  resetRepoRootCache()
  resetSeedKitRoot()
  delete process.env.QCTL_ROCKY_SEED
  const base = makeTempDir()
  temps.push(base)
  process.env.QCTL_CACHE_HOME = join(base, 'cache')
  process.env.QCTL_DATA_HOME = join(base, 'data')
})

afterEach(() => {
  process.chdir(origCwd)
  resetRepoRootCache()
  resetSeedKitRoot()
  if (origSeedEnv === undefined) delete process.env.QCTL_ROCKY_SEED
  else process.env.QCTL_ROCKY_SEED = origSeedEnv
  if (origCache === undefined) delete process.env.QCTL_CACHE_HOME
  else process.env.QCTL_CACHE_HOME = origCache
  if (origData === undefined) delete process.env.QCTL_DATA_HOME
  else process.env.QCTL_DATA_HOME = origData
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/** @returns {string} real path of a fresh initialized instance */
function makeInstance() {
  const base = makeTempDir()
  temps.push(base)
  return realpathSync(initInstance(join(base, 'inst')).root)
}

describe('vm paths', () => {
  test('getRepoRoot finds the instance from cwd and nested dirs', () => {
    const root = makeInstance()
    process.chdir(root)
    expect(getRepoRoot()).toBe(root)

    const nested = join(root, 'provision', 'nested')
    mkdirSync(nested, { recursive: true })
    process.chdir(nested)
    expect(getRepoRoot()).toBe(root)
  })

  test('XDG cache/data paths use repo hash', () => {
    const root = makeInstance()
    process.chdir(root)
    const kit = join(root, 'fake-seed-kit')
    mkdirSync(join(kit, 'cloud-init'), { recursive: true })
    writeFileSync(join(kit, 'cloud-init', 'user-data.yaml'), '#cloud-config\n')
    setSeedKitRoot(kit)

    const hash = repoHash(root)
    expect(getProvision()).toBe(join(root, 'provision'))
    expect(getCloud()).toBe(join(kit, 'cloud-init'))
    const cacheHome = /** @type {string} */ (process.env.QCTL_CACHE_HOME)
    const dataHome = /** @type {string} */ (process.env.QCTL_DATA_HOME)
    expect(getCacheHome()).toBe(cacheHome)
    expect(getDataHome()).toBe(dataHome)
    expect(getImages()).toBe(join(cacheHome, 'images'))
    expect(getTooling()).toBe(join(cacheHome, 'tooling'))
    expect(getSeed()).toBe(join(cacheHome, 'repos', hash, 'seed'))
    expect(getVms()).toBe(join(dataHome, 'repos', hash, 'vms'))
  })

  test('root cache follows cwd changes', () => {
    const a = makeInstance()
    const b = makeInstance()
    process.chdir(a)
    expect(getRepoRoot()).toBe(a)
    process.chdir(b)
    expect(getRepoRoot()).toBe(b)
  })

  test('tryGetRepoRoot is null outside an instance', () => {
    const dir = realpathSync(makeTempDir())
    temps.push(dir)
    process.chdir(dir)
    expect(tryGetRepoRoot()).toBeNull()
  })

  test('tank layout constants', () => {
    expect(DATA_COUNT).toBe(5)
    expect(SPECIAL_COUNT).toBe(2)
  })
})
