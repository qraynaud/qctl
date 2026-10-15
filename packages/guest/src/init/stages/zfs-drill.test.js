import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import zfsDrill from './zfs-drill.js'
import { afterEach, describe, expect, test } from 'bun:test'

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
  dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
  acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
}

describe('zfs-drill stage', () => {
  test('exports name and plan', () => {
    expect(zfsDrill.name).toBe('zfs-drill')
    const ctx = createContext({ env: { QCTL_ENV: 'dev' }, log: () => {} })
    expect(zfsDrill.plan(ctx).some((l) => /disks\.json|export/i.test(l))).toBe(true)
  })

  test('plan notes skip when ROCKY_SKIP_ZFS_DRILL=1', () => {
    const ctx = createContext({ env: { ROCKY_SKIP_ZFS_DRILL: '1' }, log: () => {} })
    expect(zfsDrill.plan(ctx)).toEqual(['skipped (ROCKY_SKIP_ZFS_DRILL=1)'])
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(zfsDrill.run(ctx)).rejects.toBeInstanceOf(StageError)
  })

  test('skips when no tanks in disks.json', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disksPath = join(dir, 'disks.json')
    writeFileSync(
      disksPath,
      JSON.stringify({
        os: { id: 'os' },
        data: {},
        tanks: {},
        members: [],
        encryptedTankIds: [],
      }),
    )
    /** @type {string[]} */
    const logs = []
    const ctx = createContext({
      env: { ROCKY_DISKS_JSON: disksPath },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    await zfsDrill.run(ctx)
    expect(logs.some((l) => /no tanks/i.test(l))).toBe(true)
  })

  test('drills each tank from disks.json', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const mountTank = join(dir, 'mnt-tank')
    mkdirSync(mountTank, { recursive: true })
    const canary = join(mountTank, '.rocky-canary')
    writeFileSync(canary, 'canary-body\n')
    const disksPath = join(dir, 'disks.json')
    writeFileSync(
      disksPath,
      JSON.stringify({
        os: { id: 'os' },
        data: {},
        tanks: {
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
        },
        members: [],
        encryptedTankIds: [],
      }),
    )

    /** @type {string[][]} */
    const execs = []
    /** @type {boolean} */
    let imported = true
    const cacheDir = join(dir, 'zfs-list.cache')
    mkdirSync(cacheDir, { recursive: true })
    // Non-empty cache so tankEnableBootUnlock does not poll for zed.
    writeFileSync(join(cacheDir, 'tank'), 'tank\t/mnt\n')
    const ctx = createContext({
      env: {
        ROCKY_DISKS_JSON: disksPath,
        ROCKY_ZFS_LIST_CACHE_DIR: cacheDir,
        ROCKY_TANK_MOUNT_RETRY_MS: '0',
      },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        execs.push(argv)
        if (argv[0] === 'modprobe') return { code: 0, stdout: '', stderr: '' }
        if (argv[0] === 'zpool' && argv[1] === 'list') {
          return imported
            ? { code: 0, stdout: 'tank\n', stderr: '' }
            : { code: 1, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('encryption')) {
          return { code: 0, stdout: 'off\n', stderr: '' }
        }
        if (argv[0] === 'findmnt') {
          if (!imported) return { code: 1, stdout: '', stderr: '' }
          if (argv.includes('FSTYPE,SOURCE,TARGET')) {
            return { code: 0, stdout: `zfs tank ${mountTank}\n`, stderr: '' }
          }
          return { code: 0, stdout: mountTank, stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('mounted')) {
          return { code: 0, stdout: imported ? 'yes\n' : 'no\n', stderr: '' }
        }
        if (argv[0] === 'systemd-escape') {
          return { code: 0, stdout: 'mnt-tank.mount\n', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'export') {
          imported = false
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'import') {
          imported = true
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'status') {
          return { code: 0, stdout: 'pool: tank\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv.includes('canmount')) {
          return { code: 0, stdout: 'on\n', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await zfsDrill.run(ctx)
    expect(execs.some((a) => a[0] === 'zpool' && a[1] === 'export' && a.includes('tank'))).toBe(
      true,
    )
    expect(execs.some((a) => a[0] === 'zpool' && a[1] === 'import')).toBe(true)
  })
})
