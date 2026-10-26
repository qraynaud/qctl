import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SEED_PROFILE, seedConfigSchema } from '@qctl/shared'
import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { buildSeedConfig, seedInterfacesFromProvision, stageSeedTree } from './seed-tree.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { SeedVars } from './vars.js' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

const resolvedDisks = {
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

describe('seedInterfacesFromProvision', () => {
  test('strips ethernet.vm; keeps vlan/dummy', () => {
    expect(
      seedInterfacesFromProvision({
        main: {
          type: 'ethernet',
          iface: 'eth0',
          vm: { mode: 'bridge', bridge: 'vmbr0', vlan: { mode: 'access', ids: [10] } },
          ipv4: { dhcp: true },
        },
        apps: { type: 'vlan', iface: 'eth0.2', id: 2, parent: 'main' },
        vlan2: { type: 'dummy', iface: 'vlan2' },
      }),
    ).toEqual({
      main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
      apps: { type: 'vlan', iface: 'eth0.2', id: 2, parent: 'main' },
      vlan2: { type: 'dummy', iface: 'vlan2' },
    })
  })
})

describe('buildSeedConfig / stageSeedTree', () => {
  test('builds provision-shaped networking and stages config.json + tier0', async () => {
    const vars = {
      env: 'dev',
      profile: 'appliance',
      admin_ssh_authorized_keys: 'ssh-ed25519 AAAA test\n',
      guest_credential_keys: ['tank_passphrase_tank', 'DEPLOY_KEY'],
      resolved_disks: resolvedDisks,
      init_tank_pools: '',
      init_tank_primary_pool: 'tank',
      init_tank_force: false,
      provision: {
        users: {
          apps: {
            username: 'apps',
            uid: 900,
            gid: 900,
            subuid: { start: 900000, count: 32768 },
            subgid: { start: 900000, count: 32768 },
          },
        },
        repo: { vcs: 'hg', url: 'ssh://hg@example/r', branch: 'default', dir: '/tank/rocky' },
        networking: {
          ports: {},
          interfaces: {
            main: {
              type: 'ethernet',
              iface: 'eth0',
              vm: { mode: 'bridge', bridge: 'vmbr0' },
            },
            vlan2: { type: 'dummy', iface: 'vlan2' },
          },
        },
        packages: { distro: ['curl'], pipx: ['hg'], http: [] },
      },
    }

    const config = buildSeedConfig(/** @type {SeedVars} */ (/** @type {unknown} */ (vars)))
    expect(config.profile).toBe(SEED_PROFILE.APPLIANCE)
    expect(config.packages.pipx).toEqual([{ package: 'hg', inject: [] }])
    expect(config.networking.interfaces).toEqual({
      main: { type: 'ethernet', iface: 'eth0' },
      vlan2: { type: 'dummy', iface: 'vlan2' },
    })
    expect(Object.hasOwn(config.networking.interfaces.main, 'vm')).toBe(false)
    expect(config.tier0Keys).toEqual(['tank_passphrase_tank', 'DEPLOY_KEY'])
    expect(config.users.admin).toEqual({ username: 'admin', uid: 1000, gid: 1000 })
    expect(config.initTank).toBeUndefined()
    expect(() => seedConfigSchema.parse(config)).not.toThrow()

    const dir = makeTempDir()
    temps.push(dir)
    mkdirSync(dir, { recursive: true })
    await stageSeedTree(dir, {
      config,
      tier0: {
        tank_passphrase_tank: 'secret-pass',
        DEPLOY_KEY: Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nx\n'),
      },
    })
    expect(existsSync(join(dir, 'qctl-seed', 'config.json'))).toBe(true)
    const written = JSON.parse(readFileSync(join(dir, 'qctl-seed', 'config.json'), 'utf8'))
    expect(written.root).toBe('/tank/rocky')
    expect(written.networking.interfaces.main).toEqual({ type: 'ethernet', iface: 'eth0' })
    expect(Object.hasOwn(written, 'secret')).toBe(false)
    expect(readFileSync(join(dir, 'qctl-seed', 'tier0', 'tank_passphrase_tank'), 'utf8')).toBe(
      'secret-pass',
    )
    expect(readFileSync(join(dir, 'qctl-seed', 'tier0', 'DEPLOY_KEY'))).toBeInstanceOf(Buffer)
  })

  test('init-tank profile includes initTank block', () => {
    const config = buildSeedConfig(
      /** @type {SeedVars} */ (
        /** @type {unknown} */ ({
          env: 'dev',
          profile: 'init-tank',
          admin_ssh_authorized_keys: 'ssh-ed25519 AAAA\n',
          guest_credential_keys: [],
          resolved_disks: resolvedDisks,
          init_tank_pools: 'tank,other',
          init_tank_primary_pool: 'tank',
          init_tank_force: true,
          provision: {
            users: {
              apps: {
                username: 'apps',
                uid: 900,
                gid: 900,
                subuid: { start: 900000, count: 32768 },
                subgid: { start: 900000, count: 32768 },
              },
            },
            repo: { vcs: 'git' },
            networking: {
              ports: {},
              interfaces: { main: { type: 'ethernet', iface: 'eth0' } },
            },
            packages: {},
          },
        })
      ),
    )
    expect(config.networking.interfaces).toEqual({
      main: { type: 'ethernet', iface: 'eth0' },
    })
    expect(config.profile).toBe(SEED_PROFILE.INIT_TANK)
    expect(config.initTank).toEqual({
      pools: ['tank', 'other'],
      primaryPool: 'tank',
      force: true,
    })
  })
})
