import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import tankCreate from './tank-create.js'
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

describe('tank-create stage', () => {
  test('exports name and plan', () => {
    expect(tankCreate.name).toBe('tank-create')
    const ctx = createContext({ env: { QCTL_ENV: 'dev' }, log: () => {} })
    expect(tankCreate.plan(ctx).some((l) => /vdev role registry|disks\.json/i.test(l))).toBe(true)
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev', ROCKY_TANK_CREATE_I_UNDERSTAND: 'yes' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(tankCreate.run(ctx)).rejects.toBeInstanceOf(StageError)
  })

  test('creates pool from disks.json topology (no child datasets)', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disksPath = join(dir, 'disks.json')
    const cred = join(dir, 'tank_passphrase_tank')
    const stamp = join(dir, 'init-tank-done')
    const okMarker = join(dir, 'ok')
    writeFileSync(
      disksPath,
      JSON.stringify({
        os: { id: 'os' },
        data: {},
        tanks: {
          tank: {
            id: 'tank',
            mount: join(dir, 'tank'),
            options: tankOptions,
            vdevs: {
              data0: {
                role: 'data',
                type: 'raidz2',
                members: {
                  'rocky-data0': { id: 'rocky-data0' },
                  'rocky-data1': { id: 'rocky-data1' },
                  'rocky-data2': { id: 'rocky-data2' },
                  'rocky-data3': { id: 'rocky-data3' },
                  'rocky-data4': { id: 'rocky-data4' },
                },
              },
              special0: {
                role: 'special',
                type: 'mirror',
                members: {
                  'rocky-special0': { id: 'rocky-special0' },
                  'rocky-special1': { id: 'rocky-special1' },
                },
              },
            },
          },
        },
        members: [],
        encryptedTankIds: ['tank'],
      }),
    )

    /** @type {string[][]} */
    const cmds = []
    const ctx = createContext({
      env: {
        ROCKY_TANK_CREATE_I_UNDERSTAND: 'yes',
        ROCKY_DISKS_JSON: disksPath,
        ROCKY_TANK_CRED_FILE: cred,
        ROCKY_INIT_TANK_STAMP: stamp,
        ROCKY_INIT_TANK_OK: okMarker,
        tank_passphrase_tank: 'secret',
        ROCKY_CREDSTORE_DIR: dir,
        ROCKY_ZFS_LIST_CACHE_DIR: join(dir, 'zfs-list.cache'),
      },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        cmds.push(argv)
        if (argv[0] === 'bash' && argv[2]?.includes('command -v zpool')) {
          return { code: 0, stdout: '/usr/sbin/zpool\n', stderr: '' }
        }
        if (argv[0] === 'bash' && argv[2]?.includes('by-id')) {
          const serial = argv[3]
          return { code: 0, stdout: `/dev/${serial}\n`, stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'list') {
          return { code: 1, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'import' && argv.length === 2) {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'zpool' && argv[1] === 'create') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'systemd-escape') {
          return { code: 0, stdout: 'tank.mount\n', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await tankCreate.run(ctx)

    const create = cmds.find((c) => c[0] === 'zpool' && c[1] === 'create')
    expect(create).toBeTruthy()
    expect(create).toContain('encryption=aes-256-gcm')
    expect(create).toContain('raidz2')
    expect(create).toContain('special')
    expect(create).toContain('mirror')
    expect(cmds.some((c) => c[0] === 'zfs' && c[1] === 'create')).toBe(false)
    expect(cmds.some((c) => c[0] === 'zpool' && c[1] === 'export')).toBe(true)
  })
})
