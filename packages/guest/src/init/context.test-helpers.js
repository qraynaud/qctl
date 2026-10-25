/**
 * Test-only helpers for {@link ./context.js} (not imported by production init).
 */
import { SEED_PROFILE } from '@qctl/shared'

import { createContext } from './context.js'

/** @import { OsConfig, SeedConfig } from '@qctl/shared' */
/** @import { StageContext } from './context.js' */

/**
 * Minimal OS config for unit tests.
 * @param {Partial<OsConfig>} [patch]
 * @returns {OsConfig}
 */
export function testOsConfig(patch = {}) {
  /** @type {OsConfig} */
  const base = {
    env: 'dev',
    root: '/tank/rocky',
    repo: { vcs: 'git' },
    quadletUser: 'apps',
    apps: {
      username: 'apps',
      uid: 900,
      gid: 900,
      subuid: { start: 900000, count: 65536 },
      subgid: { start: 900000, count: 65536 },
    },
    admin: {
      username: 'admin',
      uid: 1000,
      gid: 1000,
    },
    timezone: 'Europe/Paris',
    profile: SEED_PROFILE.APPLIANCE,
  }
  return {
    ...base,
    ...patch,
    repo: { ...base.repo, ...patch.repo },
    apps: {
      ...base.apps,
      ...patch.apps,
      subuid: { ...base.apps.subuid, ...patch.apps?.subuid },
      subgid: { ...base.apps.subgid, ...patch.apps?.subgid },
    },
    admin: {
      ...base.admin,
      ...patch.admin,
    },
  }
}

/**
 * Context overrides carrying only `seedConfig.disks` (partial seed).
 * Accepts `unknown` so test literals need not satisfy DisksJson literal unions.
 *
 * @param {unknown} disks
 * @param {Partial<OsConfig>} [osPatch]
 * @returns {{ seedConfig: SeedConfig, osConfig: OsConfig }}
 */
export function testSeedWithDisks(disks, osPatch = {}) {
  return {
    seedConfig: /** @type {SeedConfig} */ ({ disks }),
    osConfig: testOsConfig(osPatch),
  }
}

/**
 * {@link createContext} with a default {@link testOsConfig}.
 *
 * @param {Parameters<typeof createContext>[0]} [overrides]
 * @returns {StageContext}
 */
export function createTestContext(overrides = {}) {
  return createContext({
    ...overrides,
    osConfig: overrides.osConfig ?? testOsConfig(),
  })
}
