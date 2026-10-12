import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { capabilitiesForProfile } from './capabilities.js'
import { installInitPackages } from './install-packages.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { PlatformModule } from '@qctl/shared' */

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
  const caps = capabilitiesForProfile(profile, opts)
  const packages = Object.fromEntries(caps.map((c) => [c, { distro: [c] }]))
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

describe('installInitPackages', () => {
  test('dry-run resolves capabilities without installing', async () => {
    /** @type {string[]} */
    const lines = []
    /** @type {string[]} */
    const installed = []
    const platform = fakePlatform('default')
    platform.installPackages = async () => {
      throw new Error('should not install in dry-run')
    }
    const manifest = await installInitPackages({
      profile: 'default',
      dryRun: true,
      env: { QCTL_ENV: 'dev' },
      log: (line) => lines.push(line),
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(manifest.distro.length).toBeGreaterThan(0)
    expect(installed).toEqual([])
    expect(lines.some((l) => l.includes('dry-run'))).toBe(true)
  })

  test('default profile merges packages.json extras', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const packagesJson = join(dir, 'packages.json')
    writeFileSync(packagesJson, JSON.stringify({ distro: ['nano'] }))
    /** @type {string[]} */
    const installed = []
    const platform = fakePlatform('default')
    platform.installPackages = async (pkgs) => {
      installed.push(...pkgs)
    }
    const manifest = await installInitPackages({
      profile: 'default',
      env: { QCTL_ENV: 'dev', ROCKY_PACKAGES_JSON: packagesJson },
      log: () => {},
      loadPlatform: async () => /** @type {PlatformModule} */ (/** @type {never} */ (platform)),
    })
    expect(installed).toContain('nano')
    expect(manifest.distro).toContain('nano')
  })
})
