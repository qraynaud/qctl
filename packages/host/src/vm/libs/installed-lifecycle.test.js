import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { initInstance } from '../../init.js'
import { resetRepoRootCache } from '../../lib/paths.js'
import { INSTALLED, VmFlagNotFoundError } from './flags.js'
import {
  clearInstalled,
  composeScrubSeed,
  isInstalled,
  markInstalled,
  scrubLocalSeedArtifacts,
} from './installed-lifecycle.js'
import { resolveSeedPaths } from './seed/iso.js'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmFlagStore } from './flag-store.js' */

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
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

/**
 * Test double for INSTALLED only (not a fully generic store).
 * @param {{ value?: boolean }} [opts]
 * @returns {VmFlagStore & { ops: string[] }}
 */
function mockFlags(opts = {}) {
  /** @type {boolean | undefined} */
  let value = opts.value
  /** @type {string[]} */
  const ops = []
  /** @type {VmFlagStore & { ops: string[] }} */
  const store = {
    ops,
    async has(flag) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push('has')
      return value !== undefined
    },
    async get(flag) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push('get')
      if (value === undefined) throw new VmFlagNotFoundError(flag.name)
      return /** @type {never} */ (value)
    },
    async set(flag, v) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push(`set:${v}`)
      value = /** @type {boolean} */ (v)
    },
    async delete(flag) {
      expect(flag.name).toBe(INSTALLED.name)
      ops.push('delete')
      value = undefined
    },
    async entry(flag) {
      const out = await this.get(flag)
      return { name: flag.name, schema: flag.schema, value: out }
    },
  }
  return store
}

describe('isInstalled / clearInstalled / markInstalled', () => {
  test('isInstalled false when absent or false', async () => {
    expect(await isInstalled(mockFlags())).toBe(false)
    expect(await isInstalled(mockFlags({ value: false }))).toBe(false)
    expect(await isInstalled(mockFlags({ value: true }))).toBe(true)
  })

  test('clearInstalled deletes only when present', async () => {
    const absent = mockFlags()
    await clearInstalled(absent)
    expect(absent.ops).toEqual(['has'])

    const present = mockFlags({ value: true })
    await clearInstalled(present)
    expect(present.ops).toEqual(['has', 'delete'])
    expect(await isInstalled(present)).toBe(false)
  })

  test('markInstalled sets then runs scrubSeed', async () => {
    const flags = mockFlags()
    /** @type {string[]} */
    const scrub = []
    await markInstalled(flags, {
      scrubSeed: async () => {
        scrub.push('scrub')
      },
    })
    expect(flags.ops).toEqual(['set:true'])
    expect(scrub).toEqual(['scrub'])
    expect(await isInstalled(flags)).toBe(true)
  })

  test('markInstalled still sets if scrub throws', async () => {
    const flags = mockFlags()
    await expect(
      markInstalled(flags, {
        scrubSeed: async () => {
          throw new Error('scrub failed')
        },
      }),
    ).rejects.toThrow(/scrub failed/)
    expect(await isInstalled(flags)).toBe(true)
  })
})

describe('scrubLocalSeedArtifacts / composeScrubSeed', () => {
  test('removes iso and legacy img; keeps instance-id', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const base = makeTempDir()
    temps.push(base)
    const root = initInstance(join(base, 'inst')).root
    process.chdir(root)

    const paths = resolveSeedPaths('appliance', 'dev')
    mkdirSync(paths.root, { recursive: true })
    writeFileSync(paths.isoPath, 'iso-secret')
    writeFileSync(paths.imgPath, 'img-secret')
    writeFileSync(paths.instanceIdPath, 'rocky-dev\n')

    const { removed } = await scrubLocalSeedArtifacts({ env: 'dev' })
    expect(removed.sort()).toEqual([paths.imgPath, paths.isoPath].sort())
    expect(existsSync(paths.isoPath)).toBe(false)
    expect(existsSync(paths.imgPath)).toBe(false)
    expect(existsSync(paths.instanceIdPath)).toBe(true)
  })

  test('composeScrubSeed runs local scrub then after hook', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const base = makeTempDir()
    temps.push(base)
    const root = initInstance(join(base, 'inst')).root
    process.chdir(root)
    const paths = resolveSeedPaths('appliance', 'lab')
    mkdirSync(paths.root, { recursive: true })
    writeFileSync(paths.isoPath, 'x')

    /** @type {string[]} */
    const order = []
    const scrub = composeScrubSeed({
      env: 'lab',
      after: async () => {
        order.push('after')
      },
    })
    await scrub()
    expect(existsSync(paths.isoPath)).toBe(false)
    expect(order).toEqual(['after'])
  })
})
