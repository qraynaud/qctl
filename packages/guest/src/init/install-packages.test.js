import { capabilitiesForProfile } from './capabilities.js'
import { installInitPackages } from './install-packages.js'
import { describe, expect, test } from 'bun:test'

/** @import { DisksJson, PlatformModule, SeedConfig } from '@qctl/shared' */

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
 * @param {DisksJson} disks
 * @param {Record<string, unknown>} [packages]
 * @returns {SeedConfig}
 */
function seedWith(disks, packages) {
  return /** @type {SeedConfig} */ (
    /** @type {unknown} */ ({ disks, ...(packages ? { packages } : {}) })
  )
}

describe('installInitPackages', () => {
  test('dry-run resolves capabilities without installing', async () => {
    const seedConfig = seedWith(sampleDisks({ fs: 'xfs', tanks: true }))
    /** @type {string[]} */
    const lines = []
    const platform = fakePlatform('default')
    platform.installPackages = async () => {
      throw new Error('should not install in dry-run')
    }
    const manifest = await installInitPackages({
      profile: 'default',
      dryRun: true,
      seedConfig,
      log: (line) => lines.push(line),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(manifest.distro).toContain('xfs')
    expect(manifest.distro).toContain('zfs')
    expect(lines.some((l) => l.includes('dry-run'))).toBe(true)
  })

  test('default profile merges seed packages extras', async () => {
    const seedConfig = seedWith(sampleDisks({ fs: 'xfs', tanks: false }), {
      distro: ['nano'],
      pipx: [],
      http: [],
    })
    /** @type {string[]} */
    const installed = []
    const platform = fakePlatform('default')
    platform.installPackages = async (pkgs) => {
      installed.push(...pkgs)
    }
    const manifest = await installInitPackages({
      profile: 'default',
      seedConfig,
      log: () => {},
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(installed).toContain('nano')
    expect(installed).toContain('xfs')
    expect(installed).not.toContain('zfs')
    expect(manifest.distro).toContain('nano')
  })

  test('init-tank also merges seed packages extras (incl. http)', async () => {
    const seedConfig = seedWith(sampleDisks({ fs: 'xfs', tanks: true }), {
      distro: ['nano'],
      pipx: [],
      http: [{ url: 'https://example.com/x', bin: 'x' }],
    })
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
      seedConfig,
      log: (l) => lines.push(l),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(manifest.distro).toContain('nano')
    expect(manifest.distro).toContain('xfs')
    expect(manifest.distro).toContain('zfs')
    expect(manifest.http).toEqual([{ url: 'https://example.com/x', bin: 'x' }])
    expect(lines.some((l) => /http=1/.test(l))).toBe(true)
    expect(installed).toEqual([])
  })

  test('data-only seed disks does not request zfs', async () => {
    const seedConfig = seedWith(sampleDisks({ fs: 'ext4', tanks: false }))
    /** @type {string[]} */
    const lines = []
    const platform = fakePlatform('init-tank')
    await installInitPackages({
      profile: 'init-tank',
      dryRun: true,
      seedConfig,
      log: (l) => lines.push(l),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    const capLine = lines.find((l) => l.includes('capabilities='))
    expect(capLine).toMatch(/ext4/)
    expect(capLine).not.toMatch(/\bzfs\b/)
  })
})
