import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createTestContext, testSeedWithDisks } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import tankImport from './tank-import.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @import { DisksJson } from '@qctl/shared' */

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

const tankOptions = {
  pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
  dataset: {
    compression: 'lz4',
    atime: 'off',
    xattr: 'sa',
    special_small_blocks: 0,
  },
  acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
}

/**
 * @param {string} dir
 * @param {{ multi?: boolean, encrypted?: boolean }} [opts]
 */
function writeDisks(dir, opts = {}) {
  const encrypted = opts.encrypted !== false
  const mountTank = join(dir, 'mnt-tank')
  mkdirSync(mountTank, { recursive: true })
  /** @type {Record<string, DisksJson['tanks'][string]>} */
  const tanks = {
    tank: {
      id: 'tank',
      mount: mountTank,
      options: tankOptions,
      vdevs: {
        data0: {
          role: 'data',
          type: 'single',
          members: { 'rocky-data0': { id: 'rocky-data0' } },
        },
      },
    },
  }
  /** @type {string[]} */
  const encryptedTankIds = encrypted ? ['tank'] : []
  if (opts.multi) {
    const mountCold = join(dir, 'mnt-cold')
    mkdirSync(mountCold, { recursive: true })
    tanks.cold = {
      id: 'cold',
      mount: mountCold,
      options: tankOptions,
      vdevs: {
        data0: {
          role: 'data',
          type: 'single',
          members: { 'rocky-cold0': { id: 'rocky-cold0' } },
        },
      },
    }
    if (encrypted) encryptedTankIds.push('cold')
  }
  return {
    os: { id: 'os' },
    data: {},
    tanks,
    members: [],
    encryptedTankIds,
  }
}

describe('tank-import stage', () => {
  test('plan mentions disks.json + never create', () => {
    const ctx = createTestContext({ log: () => {} })
    expect(tankImport.plan(ctx).some((l) => /never create|disks\.json/i.test(l))).toBe(true)
  })

  test('run requires root', async () => {
    const ctx = createTestContext({
      log: () => {},
      isRoot: () => false,
    })
    await expect(tankImport.run(ctx)).rejects.toBeInstanceOf(StageError)
  })

  test('skips when disks.json has no tanks', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disks = {
      os: { id: 'os' },
      data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs' } },
      tanks: {},
      members: [],
      encryptedTankIds: [],
    }
    /** @type {string[]} */
    const logs = []
    const ctx = createTestContext({
      ...testSeedWithDisks(disks),
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    await tankImport.run(ctx)
    expect(logs.some((l) => /no tanks/i.test(l))).toBe(true)
  })

  test('reseeds key and imports when pool is importable', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disks = writeDisks(dir)
    const credDir = join(dir, 'credstore')
    mkdirSync(credDir, { recursive: true })
    const cacheDir = join(dir, 'zfs-list.cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'tank'), 'tank\t/mnt\n')

    /** @type {string[][]} */
    const execs = []
    /** @type {string[]} */
    const logs = []
    const initState = join(dir, 'init-state.json')
    const ctx = createTestContext({
      ...testSeedWithDisks(disks),
      secrets: { tank_passphrase_tank: 'lab-pass' },
      paths: { credstoreDir: credDir, zfsListCacheDir: cacheDir, initState },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async (argv) => {
        execs.push(argv)
        if (argv[0] === 'modprobe') return { code: 0, stdout: '', stderr: '' }
        if (argv[0] === 'zpool' && argv[1] === 'list') {
          return { code: 1, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'import' && argv[2] === undefined) {
          return { code: 0, stdout: '   tank\n', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'import') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('encryption')) {
          return { code: 0, stdout: 'aes-256-gcm\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('keystatus')) {
          return { code: 0, stdout: 'unavailable\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'load-key') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'findmnt' && argv.includes('FSTYPE,SOURCE,TARGET')) {
          return {
            code: 0,
            stdout: `zfs tank ${join(dir, 'mnt-tank')}\n`,
            stderr: '',
          }
        }
        if (argv[0] === 'findmnt') return { code: 0, stdout: join(dir, 'mnt-tank'), stderr: '' }
        if (argv[0] === 'zpool' && argv[1] === 'status') {
          return { code: 0, stdout: 'pool: tank\n', stderr: '' }
        }
        if (argv[0] === 'systemd-escape') {
          return { code: 0, stdout: 'mnt-tank.mount\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('canmount')) {
          return { code: 0, stdout: 'on\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('mounted')) {
          return { code: 0, stdout: 'yes\n', stderr: '' }
        }
        if (argv[0] === 'sync') return { code: 0, stdout: '', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await tankImport.run(ctx)
    expect(execs.some((a) => a[0] === 'zpool' && a[1] === 'import')).toBe(true)
    expect(execs.some((a) => a[0] === 'zfs' && a[1] === 'load-key' && a.includes('tank'))).toBe(
      true,
    )
    expect(execs.some((a) => a[0] === 'systemctl' && a.includes('zfs-zed.service'))).toBe(true)
    expect(logs.some((l) => /verified tank mounted/i.test(l))).toBe(true)
    expect(logs.some((l) => l.includes('tank-import: done'))).toBe(true)
    const state = JSON.parse(readFileSync(initState, 'utf8'))
    expect(state.tanks.tank.importedAt).toMatch(/^\d{4}-/)
  })

  test('imports multiple tanks from disks.json', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disks = writeDisks(dir, { multi: true })
    const credDir = join(dir, 'credstore')
    mkdirSync(credDir, { recursive: true })
    const cacheDir = join(dir, 'zfs-list.cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'tank'), 'tank\t/mnt\n')
    writeFileSync(join(cacheDir, 'cold'), 'cold\t/mnt\n')

    /** @type {string[]} */
    const imported = []
    const ctx = createTestContext({
      ...testSeedWithDisks(disks),
      secrets: { tank_passphrase_tank: 'a', tank_passphrase_cold: 'b' },
      paths: {
        credstoreDir: credDir,
        zfsListCacheDir: cacheDir,
        initState: join(dir, 'init-state.json'),
      },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        if (argv[0] === 'zpool' && argv[1] === 'list') {
          return { code: 1, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'import' && argv[2] === undefined) {
          return { code: 0, stdout: '   tank\n   cold\n', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'import') {
          const pool = argv[argv.length - 1]
          imported.push(pool)
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('encryption')) {
          return { code: 0, stdout: 'off\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('canmount')) {
          return { code: 0, stdout: 'on\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('mounted')) {
          return { code: 0, stdout: 'yes\n', stderr: '' }
        }
        if (argv[0] === 'findmnt' && argv.includes('FSTYPE,SOURCE,TARGET')) {
          return { code: 0, stdout: 'zfs tank /mnt\n', stderr: '' }
        }
        if (argv[0] === 'findmnt') return { code: 0, stdout: '/mnt', stderr: '' }
        if (argv[0] === 'zpool' && argv[1] === 'status') {
          return { code: 0, stdout: 'pool: x\n', stderr: '' }
        }
        if (argv[0] === 'systemd-escape') {
          return { code: 0, stdout: 'x.mount\n', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await tankImport.run(ctx)
    expect(imported.filter((p) => p === 'tank' || p === 'cold').sort()).toEqual(['cold', 'tank'])
  })

  test('fails when mount path is not a zfs mount', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disks = writeDisks(dir, { encrypted: false })
    const cacheDir = join(dir, 'zfs-list.cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'tank'), 'tank\t/mnt\n')

    const ctx = createTestContext({
      ...testSeedWithDisks(disks),
      flags: { tankMountAttempts: 2, tankMountRetryMs: 0 },
      paths: {
        zfsListCacheDir: cacheDir,
        initState: join(dir, 'init-state.json'),
      },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        if (argv[0] === 'zpool' && argv[1] === 'list') {
          return { code: 0, stdout: 'tank\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('encryption')) {
          return { code: 0, stdout: 'off\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('canmount')) {
          return { code: 0, stdout: 'on\n', stderr: '' }
        }
        if (argv[0] === 'findmnt' && argv.includes('FSTYPE,SOURCE,TARGET')) {
          return { code: 1, stdout: '', stderr: '' }
        }
        if (argv[0] === 'findmnt') return { code: 0, stdout: join(dir, 'mnt-tank'), stderr: '' }
        if (argv[0] === 'systemd-escape') {
          return { code: 0, stdout: 'mnt-tank.mount\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('mounted')) {
          return { code: 0, stdout: 'no\n', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await expect(tankImport.run(ctx)).rejects.toThrow(/not a mountpoint|mounted/)
  })
})
