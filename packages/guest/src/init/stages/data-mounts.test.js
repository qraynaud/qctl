import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import dataMounts from './data-mounts.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

describe('data-mounts stage', () => {
  test('exports name and plan', () => {
    expect(dataMounts.name).toBe('data-mounts')
    const ctx = createContext({ env: { QCTL_ENV: 'dev' }, log: () => {} })
    expect(dataMounts.plan(ctx).some((l) => /mkfs|mount only/i.test(l))).toBe(true)
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(dataMounts.run(ctx)).rejects.toBeInstanceOf(StageError)
  })

  test('skips when disks.json missing', async () => {
    /** @type {string[]} */
    const logs = []
    const ctx = createContext({
      env: { ROCKY_DISKS_JSON: '/tmp/qctl-missing-disks.json' },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    await dataMounts.run(ctx)
    expect(logs.some((l) => /no disks\.json/i.test(l))).toBe(true)
  })

  test('blank disk → mkfs then mount; existing FS → no mkfs', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const disksPath = join(dir, 'disks.json')
    writeFileSync(
      disksPath,
      JSON.stringify({
        os: { id: 'os' },
        data: {
          vw: { id: 'vw', mount: join(dir, 'mnt-vw'), fs: 'xfs' },
          extra: { id: 'extra', mount: join(dir, 'mnt-extra'), fs: 'ext4' },
        },
        tanks: {},
        members: [
          { id: 'os', kind: 'os' },
          { id: 'vw', kind: 'data', owner: 'vw' },
          { id: 'extra', kind: 'data', owner: 'extra' },
        ],
        encryptedTankIds: [],
      }),
    )

    /** @type {string[][]} */
    const cmds = []
    /** @type {Record<string, string>} */
    const blkidType = { '/dev/vdb': '', '/dev/vdc': 'ext4' }
    /** @type {Record<string, string>} */
    const blkidUuid = { '/dev/vdb': 'uuid-vw', '/dev/vdc': 'uuid-extra' }

    const fstabPath = join(dir, 'fstab')
    writeFileSync(fstabPath, '')
    const ctx = createContext({
      env: { ROCKY_DISKS_JSON: disksPath, ROCKY_FSTAB: fstabPath },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        cmds.push(argv)
        if (argv[0] === 'findmnt') return { code: 1, stdout: '', stderr: '' }
        if (argv[0] === 'lsblk') {
          return {
            code: 0,
            stdout: 'vdb vw disk\nvdc extra disk\n',
            stderr: '',
          }
        }
        if (argv[0] === 'blkid' && argv.includes('TYPE')) {
          const dev = argv[argv.length - 1] || ''
          return { code: 0, stdout: `${blkidType[dev] || ''}\n`, stderr: '' }
        }
        if (argv[0] === 'blkid' && argv.includes('UUID')) {
          const dev = argv[argv.length - 1] || ''
          return { code: 0, stdout: `${blkidUuid[dev] || ''}\n`, stderr: '' }
        }
        if (argv[0] === 'mkfs.xfs' || argv[0] === 'mkfs.ext4') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (argv[0] === 'mount' || argv[0] === 'udevadm') {
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await dataMounts.run(ctx)

    expect(cmds.some((c) => c[0] === 'mkfs.xfs' && c.includes('/dev/vdb'))).toBe(true)
    expect(cmds.some((c) => c[0] === 'mkfs.ext4')).toBe(false)
    expect(cmds.filter((c) => c[0] === 'mount').length).toBe(2)
  })

  test('already mounted → skip format', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const mount = join(dir, 'mnt')
    const disksPath = join(dir, 'disks.json')
    writeFileSync(
      disksPath,
      JSON.stringify({
        os: { id: 'os' },
        data: { vw: { id: 'vw', mount, fs: 'xfs' } },
        tanks: {},
        members: [
          { id: 'os', kind: 'os' },
          { id: 'vw', kind: 'data', owner: 'vw' },
        ],
        encryptedTankIds: [],
      }),
    )
    /** @type {string[][]} */
    const cmds = []
    const ctx = createContext({
      env: { ROCKY_DISKS_JSON: disksPath },
      log: () => {},
      isRoot: () => true,
      exec: async (argv) => {
        cmds.push(argv)
        if (argv[0] === 'findmnt') return { code: 0, stdout: mount, stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    await dataMounts.run(ctx)
    expect(cmds.some((c) => c[0] === 'mkfs.xfs' || c[0] === 'lsblk')).toBe(false)
  })
})
