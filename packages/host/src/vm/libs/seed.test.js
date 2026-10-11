import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '../../../../shared/src/test-helpers.js'
import { initInstance } from '../../init.js'
import { getSeed, repoHash, resetRepoRootCache } from './paths.js'
import { HG_HGRC_PATH, HG_PIPX_DEFAULT } from './secrets-schema.js'
import {
  embedGuestTooling,
  filesForSeedProfile,
  packagesForSeedProfile,
  resolveSeedPaths,
} from './seed.js'
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

describe('seed', () => {
  test('packagesForSeedProfile keeps user pipx; auto mercurial only on appliance+hg', () => {
    const pkgs = {
      distro: ['nano'],
      pipx: [{ package: 'cowsay', inject: [] }],
      http: [{ url: 'https://example.com/bw.zip', bin: 'bw', dest: null, test: null }],
    }
    expect(packagesForSeedProfile('init-tank', pkgs, 'hg')).toEqual(pkgs)
    const appliance = packagesForSeedProfile('appliance', pkgs, 'hg')
    expect(appliance.pipx[0]).toEqual({
      package: HG_PIPX_DEFAULT.package,
      inject: [...HG_PIPX_DEFAULT.inject],
    })
    expect(appliance.pipx[1]).toEqual({ package: 'cowsay', inject: [] })
    expect(packagesForSeedProfile('appliance', pkgs, 'git').pipx).toEqual(pkgs.pipx)
  })

  test('filesForSeedProfile adds hgrc only on appliance+hg', () => {
    expect(filesForSeedProfile('init-tank', [], 'hg')).toEqual([])
    const appliance = filesForSeedProfile('appliance', [], 'hg')
    expect(appliance).toHaveLength(1)
    expect(appliance[0].path).toBe(HG_HGRC_PATH)
  })

  test('resolveSeedPaths is under XDG cache repos/<hash>/seed', () => {
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

  test('embedGuestTooling copies compiled guest binaries when present', async () => {
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
    // Plugins are installed on the guest (`qctl plugins ensure`), not baked into seed.
    expect(existsSync(join(out, 'qctl-guest', 'varlock', 'plugins-cache'))).toBe(false)
  })

  test('embedGuestTooling stages varlock-local-encrypt (no bootstrap graph)', async () => {
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

  test('embedGuestTooling without dist binaries still creates qctl-guest dir', async () => {
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
