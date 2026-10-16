import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { capabilitiesForProfile } from './capabilities.js'
import { installInitPackages } from './install-packages.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { DisksJson, PlatformModule } from '@qctl/shared' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {string} profile
 * @param {{ vcs?: string }} [opts]
 */
function fakePlatform(profile, opts = {}) {
  // Include FS/zfs so disks.json-driven caps resolve even when opts omit disks.
  const caps = new Set([...capabilitiesForProfile(profile, opts), 'xfs', 'ext4', 'zfs'])
  const packages = Object.fromEntries([...caps].map((c) => [c, { distro: [c] }]))
  return {
    id: 'fake',
    packages,
    /**
     * @param {string[]} pkgs
     * @param {{ installed: string[] }} track
     */
    installPackages: async (pkgs, track) => {
      track.installed.push(...pkgs)
    },
  }
}

const tankOptions = {
  pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
  dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
  acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
}

/**
 * @param {{ fs?: string, tanks?: boolean }} [opts]
 * @returns {DisksJson}
 */
function sampleDisks(opts = {}) {
  const fs = opts.fs ?? 'xfs'
  const withTanks = opts.tanks !== false
  /** @type {DisksJson} */
  const disks = {
    os: { id: 'os', size: '20G' },
    data: { vw: { id: 'vw', mount: '/vw', fs, size: '2G' } },
    tanks: {},
    members: [
      { id: 'os', kind: 'os', size: '20G' },
      { id: 'vw', kind: 'data', size: '2G', owner: 'vw' },
    ],
    encryptedTankIds: [],
  }
  if (withTanks) {
    disks.tanks = {
      tank: {
        id: 'tank',
        mount: '/tank',
        options: tankOptions,
        vdevs: {
          data0: {
            role: 'data',
            type: 'single',
            members: { 'rocky-data0': { id: 'rocky-data0', size: '2G' } },
          },
        },
      },
    }
    disks.members.push({
      id: 'rocky-data0',
      kind: 'tank',
      size: '2G',
      owner: 'tank',
      role: 'data',
    })
    disks.encryptedTankIds = ['tank']
  }
  return disks
}

/**
 * @param {string} dir
 * @param {DisksJson} disks
 */
function writeDisks(dir, disks) {
  const path = join(dir, 'disks.json')
  writeFileSync(path, JSON.stringify(disks))
  return path
}

describe('installInitPackages', () => {
  test('dry-run resolves capabilities without installing', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disksJson = writeDisks(dir, sampleDisks({ fs: 'xfs', tanks: true }))
    /** @type {string[]} */
    const lines = []
    const platform = fakePlatform('default')
    platform.installPackages = async () => {
      throw new Error('should not install in dry-run')
    }
    const manifest = await installInitPackages({
      profile: 'default',
      dryRun: true,
      env: { QCTL_ENV: 'dev', ROCKY_DISKS_JSON: disksJson },
      log: (line) => lines.push(line),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(manifest.distro).toContain('xfs')
    expect(manifest.distro).toContain('zfs')
    expect(lines.some((l) => l.includes('dry-run'))).toBe(true)
  })

  test('default profile merges packages.json extras', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const packagesJson = join(dir, 'packages.json')
    writeFileSync(packagesJson, JSON.stringify({ distro: ['nano'] }))
    const disksJson = writeDisks(dir, sampleDisks({ fs: 'xfs', tanks: false }))
    /** @type {string[]} */
    const installed = []
    const platform = fakePlatform('default')
    platform.installPackages = async (pkgs) => {
      installed.push(...pkgs)
    }
    const manifest = await installInitPackages({
      profile: 'default',
      env: {
        QCTL_ENV: 'dev',
        ROCKY_PACKAGES_JSON: packagesJson,
        ROCKY_DISKS_JSON: disksJson,
      },
      log: () => {},
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(installed).toContain('nano')
    expect(installed).toContain('xfs')
    expect(installed).not.toContain('zfs')
    expect(manifest.distro).toContain('nano')
  })

  test('init-tank also merges packages.json extras (incl. http)', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const packagesJson = join(dir, 'packages.json')
    writeFileSync(
      packagesJson,
      JSON.stringify({
        distro: ['nano'],
        http: [{ url: 'https://example.com/x', bin: 'x' }],
      }),
    )
    const disksJson = writeDisks(dir, sampleDisks({ fs: 'xfs', tanks: true }))
    /** @type {string[]} */
    const installed = []
    const platform = fakePlatform('init-tank')
    platform.installPackages = async (pkgs) => {
      installed.push(...pkgs)
    }
    /** @type {string[]} */
    const lines = []
    const manifest = await installInitPackages({
      profile: 'init-tank',
      dryRun: true,
      env: { ROCKY_PACKAGES_JSON: packagesJson, ROCKY_DISKS_JSON: disksJson },
      log: (l) => lines.push(l),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(manifest.distro).toContain('nano')
    expect(manifest.distro).toContain('xfs')
    expect(manifest.distro).toContain('zfs')
    expect(manifest.http).toEqual([
      { url: 'https://example.com/x', bin: 'x', dest: null, test: null },
    ])
    expect(lines.some((l) => /http=1/.test(l))).toBe(true)
    expect(installed).toEqual([])
  })

  test('data-only disks.json does not request zfs', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disksJson = writeDisks(dir, sampleDisks({ fs: 'ext4', tanks: false }))
    /** @type {string[]} */
    const lines = []
    const platform = fakePlatform('init-tank')
    await installInitPackages({
      profile: 'init-tank',
      dryRun: true,
      env: { ROCKY_DISKS_JSON: disksJson },
      log: (l) => lines.push(l),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    const capLine = lines.find((l) => l.includes('capabilities='))
    expect(capLine).toMatch(/ext4/)
    expect(capLine).not.toMatch(/\bzfs\b/)
  })
})
