import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  QCTL_SEED_CONFIG_ISO_REL,
  QCTL_SEED_TIER0_ISO_REL,
  SEED_PROFILE,
  seedConfigSchema,
  seedConfigToOsConfig,
} from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  loadSecretsFromTier0Pending,
  loadSeedFromIso,
  materializeSeedSidecars,
  parseSeedConfigFile,
  syncTier0Pending,
  writeOsConfig,
} from './load-seed-config.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { SeedConfig } from '@qctl/shared' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

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

/** @returns {SeedConfig} */
function sampleSeed() {
  return seedConfigSchema.parse({
    env: 'dev',
    root: '/tank/rocky',
    repo: { vcs: 'hg', url: 'ssh://hg@example/repo', branch: 'default' },
    users: {
      apps,
      admin: { username: 'admin', uid: 1000, gid: 1000 },
    },
    disks,
    ports: {},
    packages: { distro: ['curl'], pipx: [], http: [] },
    vlanParents: {},
    profile: SEED_PROFILE.APPLIANCE,
    timezone: 'Europe/Paris',
    adminSshAuthorizedKeys: 'ssh-ed25519 AAAA example\n',
    tier0Keys: ['ADMIN_USERNAME', 'tank_passphrase_tank'],
  })
}

/**
 * @param {string} root
 * @param {SeedConfig} seed
 * @param {Record<string, string>} tier0
 */
function stageSeedTree(root, seed, tier0) {
  const configPath = join(root, QCTL_SEED_CONFIG_ISO_REL)
  const tier0Dir = join(root, QCTL_SEED_TIER0_ISO_REL)
  mkdirSync(tier0Dir, { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(seed, null, 2)}\n`)
  for (const [k, v] of Object.entries(tier0)) {
    writeFileSync(join(tier0Dir, k), v, { mode: 0o400 })
  }
}

describe('materializeSeedSidecars', () => {
  test('writes admin keys + vlan-parents.env', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const adminKeysPath = join(dir, 'admin_keys')
    const vlanParentsPath = join(dir, 'vlan-parents.env')
    const seed = sampleSeed()
    seed.vlanParents = { VLAN2_PARENT: 'vlan2', VLAN2_IPV4: '10.0.2.2' }
    materializeSeedSidecars(seed, { adminKeysPath, vlanParentsPath })
    expect(readFileSync(adminKeysPath, 'utf8')).toContain('ssh-ed25519')
    expect(readFileSync(vlanParentsPath, 'utf8')).toBe('VLAN2_IPV4=10.0.2.2\nVLAN2_PARENT=vlan2\n')
  })
})

describe('parseSeedConfigFile / writeOsConfig', () => {
  test('OS config omits secrets and tier0Keys', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const seed = sampleSeed()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, `${JSON.stringify(seed)}\n`)
    const parsed = parseSeedConfigFile(configPath)
    const osPath = join(dir, 'os-config.json')
    const os = seedConfigToOsConfig(parsed)
    writeOsConfig(os, osPath)
    const written = JSON.parse(readFileSync(osPath, 'utf8'))
    expect(written.env).toBe('dev')
    expect(written.root).toBe('/tank/rocky')
    expect(written.admin).toEqual({ username: 'admin', uid: 1000, gid: 1000 })
    expect(Object.hasOwn(written, 'tier0Keys')).toBe(false)
    expect(Object.hasOwn(written, 'disks')).toBe(false)
    expect(Object.hasOwn(written, 'adminSshAuthorizedKeys')).toBe(false)
    expect(JSON.stringify(written)).not.toMatch(/passphrase|ADMIN_USERNAME|secret/i)
  })
})

describe('syncTier0Pending', () => {
  test('copies opaque bytes and enforces expectedKeys', () => {
    const base = makeTempDir()
    temps.push(base)
    const iso = join(base, 'tier0')
    const pending = join(base, 'pending')
    mkdirSync(iso, { recursive: true })
    writeFileSync(join(iso, 'ADMIN_USERNAME'), 'admin')
    writeFileSync(join(iso, 'tank_passphrase_tank'), 'secret-pass')
    const synced = syncTier0Pending(iso, pending, {
      expectedKeys: ['ADMIN_USERNAME', 'tank_passphrase_tank'],
    })
    expect(synced).toEqual(['ADMIN_USERNAME', 'tank_passphrase_tank'])
    expect(readFileSync(join(pending, 'tank_passphrase_tank'), 'utf8')).toBe('secret-pass')
    expect(() =>
      syncTier0Pending(iso, pending, { expectedKeys: ['ADMIN_USERNAME', 'MISSING'] }),
    ).toThrow(/MISSING/)
  })
})

describe('loadSeedFromIso', () => {
  test('loads config, syncs tier0, writes OS config, returns secrets', () => {
    const root = makeTempDir()
    temps.push(root)
    const seed = sampleSeed()
    stageSeedTree(root, seed, {
      ADMIN_USERNAME: 'admin',
      tank_passphrase_tank: 'pass',
    })
    const osPath = join(root, 'etc-qctl-config.json')
    const pending = join(root, 'pending')
    const adminKeysPath = join(root, 'admin_keys')
    const vlanParentsPath = join(root, 'vlan-parents.env')
    /** @type {string[]} */
    const logs = []
    const result = loadSeedFromIso(
      { root, seedDir: join(root, 'qctl-seed') },
      {
        log: (l) => logs.push(l),
        osConfigPath: osPath,
        tier0PendingDir: pending,
        adminKeysPath,
        vlanParentsPath,
      },
    )
    expect(result.seed.env).toBe('dev')
    expect(result.os.quadletUser).toBe('apps')
    expect(result.tier0Synced).toEqual(['ADMIN_USERNAME', 'tank_passphrase_tank'])
    expect(existsSync(osPath)).toBe(true)
    expect(result.os.root).toBe('/tank/rocky')
    expect(result.os.timezone).toBe('Europe/Paris')
    expect(result.secrets).toEqual({ ADMIN_USERNAME: 'admin', tank_passphrase_tank: 'pass' })
    expect(readFileSync(join(pending, 'ADMIN_USERNAME'), 'utf8')).toBe('admin')
    expect(existsSync(adminKeysPath)).toBe(true)
    expect(existsSync(vlanParentsPath)).toBe(true)
    const osJson = JSON.parse(readFileSync(osPath, 'utf8'))
    expect(Object.hasOwn(osJson, 'tier0Keys')).toBe(false)
    expect(logs[0]).toMatch(/load-seed/)
  })
})

describe('loadSecretsFromTier0Pending', () => {
  test('utf8 secrets and non-utf8 → base64', () => {
    const dir = makeTempDir()
    temps.push(dir)
    writeFileSync(join(dir, 'TANK'), 'secret\n')
    writeFileSync(join(dir, 'BIN'), Buffer.from([0xff, 0x00, 0x1f]))
    const secrets = loadSecretsFromTier0Pending(dir)
    expect(secrets.TANK).toBe('secret')
    expect(secrets.BIN).toBe(Buffer.from([0xff, 0x00, 0x1f]).toString('base64'))
  })

  test('missing dir → empty', () => {
    expect(loadSecretsFromTier0Pending('/tmp/qctl-no-such-pending-dir')).toEqual({})
  })
})
