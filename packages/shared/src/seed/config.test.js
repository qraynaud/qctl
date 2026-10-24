import {
  QCTL_GUEST_ISO_DIR,
  QCTL_OS_CONFIG_PATH,
  QCTL_SEED_CONFIG_ISO_REL,
  QCTL_SEED_TIER0_ISO_REL,
  SEED_PROFILE,
  osConfigSchema,
  seedConfigSchema,
  seedConfigToOsConfig,
} from './config.js'
import { describe, expect, test } from 'bun:test'

/** Minimal valid disks.json for seed fixtures. */
const disks = {
  os: { id: 'os', size: '20G' },
  data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
  tanks: {
    tank: {
      id: 'tank',
      mount: '/tank',
      options: {
        pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
        dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
        acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
      },
      vdevs: {
        data0: {
          role: 'data',
          type: 'single',
          members: { 'rocky-data0': { id: 'rocky-data0', size: '2G' } },
        },
      },
    },
  },
  members: [
    { id: 'os', kind: 'os', size: '20G' },
    { id: 'vw', kind: 'data', size: '2G', owner: 'vw' },
    { id: 'rocky-data0', kind: 'tank', size: '2G', owner: 'tank', role: 'data' },
  ],
  encryptedTankIds: ['tank'],
}

const apps = {
  username: 'apps',
  uid: 900,
  gid: 900,
  subuid: { start: 900000, count: 32768 },
  subgid: { start: 900000, count: 32768 },
}

const sampleSeedDefaults = {
  env: 'dev',
  root: '/tank/rocky',
  repo: { vcs: /** @type {const} */ ('hg'), url: 'ssh://hg@example/repo', branch: 'default' },
  users: { apps },
  disks,
  ports: {},
  packages: {
    distro: ['curl'],
    pipx: /** @type {never[]} */ ([]),
    http: /** @type {never[]} */ ([]),
  },
  vlanParents: { VLAN2_PARENT: 'vlan2' },
  profile: SEED_PROFILE.APPLIANCE,
  timezone: 'Europe/Paris',
  adminSshAuthorizedKeys: 'ssh-ed25519 AAAA example\n',
  tier0Keys: ['ADMIN_USERNAME', 'tank_passphrase_tank'],
}

/**
 * @template {Record<string, unknown>} [T=Record<string, never>]
 * @param {T} [overrides]
 * @returns {typeof sampleSeedDefaults & T}
 */
function sampleSeed(overrides = /** @type {T} */ ({})) {
  return { ...sampleSeedDefaults, ...overrides }
}

describe('seed path constants', () => {
  test('ISO + OS paths', () => {
    expect(QCTL_GUEST_ISO_DIR).toBe('qctl-guest')
    expect(QCTL_SEED_CONFIG_ISO_REL).toBe('qctl-seed/config.json')
    expect(QCTL_SEED_TIER0_ISO_REL).toBe('qctl-seed/tier0')
    expect(QCTL_OS_CONFIG_PATH).toBe('/etc/qctl/config.json')
  })
})

describe('seedConfigSchema', () => {
  test('accepts appliance payload', () => {
    const out = seedConfigSchema.parse(sampleSeed())
    expect(out.profile).toBe('appliance')
    expect(out.root).toBe('/tank/rocky')
    expect(out.ports.ssh.forward).toBe(2222)
    expect(out.tier0Keys).toEqual(['ADMIN_USERNAME', 'tank_passphrase_tank'])
    expect(out.initTank).toBeUndefined()
  })

  test('accepts init-tank with initTank block', () => {
    const out = seedConfigSchema.parse(
      sampleSeed({
        profile: SEED_PROFILE.INIT_TANK,
        initTank: { pools: ['tank'], primaryPool: 'tank', force: false },
      }),
    )
    expect(out.profile).toBe('init-tank')
    expect(out.initTank?.pools).toEqual(['tank'])
  })

  test('rejects unknown keys (strict) and tank passphrase fields', () => {
    expect(() => seedConfigSchema.parse(sampleSeed({ secret: 'nope' }))).toThrow()
    const badDisks = structuredClone(disks)
    // @ts-expect-error intentional
    badDisks.tanks.tank.passphrase = 'secret'
    expect(() => seedConfigSchema.parse(sampleSeed({ disks: badDisks }))).toThrow()
  })

  test('normalizes pipx string shorthand in packages', () => {
    const out = seedConfigSchema.parse(
      sampleSeed({
        packages: { distro: [], pipx: ['hg'], http: [] },
      }),
    )
    expect(out.packages.pipx).toEqual([{ package: 'hg', inject: [] }])
  })

  test('rejects leading/trailing whitespace on identity strings', () => {
    expect(() => seedConfigSchema.parse(sampleSeed({ env: ' dev' }))).toThrow()
    expect(() => seedConfigSchema.parse(sampleSeed({ root: '/tank/rocky ' }))).toThrow()
  })
})

describe('osConfigSchema / seedConfigToOsConfig', () => {
  test('os config is identity subset without disks/ports/packages/tier0', () => {
    const seed = seedConfigSchema.parse(sampleSeed())
    const os = seedConfigToOsConfig(seed)
    expect(os).toEqual({
      env: 'dev',
      root: '/tank/rocky',
      repo: { vcs: 'hg', url: 'ssh://hg@example/repo', branch: 'default' },
      quadletUser: 'apps',
      apps,
      timezone: 'Europe/Paris',
      profile: 'appliance',
    })
    expect('disks' in os).toBe(false)
    expect('tier0Keys' in os).toBe(false)
    expect('packages' in os).toBe(false)
  })

  test('osConfigSchema rejects seed-only fields', () => {
    const seed = seedConfigSchema.parse(sampleSeed())
    expect(() => osConfigSchema.parse(seed)).toThrow()
  })
})
