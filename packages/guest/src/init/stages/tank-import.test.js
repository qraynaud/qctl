import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createContext } from '../context.js'
import tankImport from './tank-import.js'
import { describe, expect, test } from 'bun:test'

describe('tank-import stage', () => {
  test('reseeds key and imports when pool is importable', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tank-import-'))
    const cred = join(base, 'tank_passphrase')
    const mount = join(base, 'tank')
    const canary = join(mount, '.rocky-canary')
    mkdirSync(mount, { recursive: true })

    /** @type {string[][]} */
    const execs = []
    /** @type {string[]} */
    const logs = []
    const ctx = createContext({
      env: {
        QCTL_ENV: 'dev',
        TANK_PASSPHRASE: 'lab-pass',
        ROCKY_TANK_CRED_FILE: cred,
        ROCKY_TANK_MOUNT: mount,
        ROCKY_TANK_CANARY: canary,
        ROCKY_ZFS_POOL: 'tank',
      },
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
        if (argv[0] === 'zfs' && argv[1] === 'get' && argv[3] === 'encryption') {
          return { code: 0, stdout: 'off\n', stderr: '' }
        }
        if (argv[0] === 'findmnt') return { code: 0, stdout: mount, stderr: '' }
        if (argv[0] === 'zpool' && argv[1] === 'status') {
          return { code: 0, stdout: 'pool: tank\n', stderr: '' }
        }
        if (argv[0] === 'sync') return { code: 0, stdout: '', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      },
    })

    await tankImport.run(ctx)
    expect(readFileSync(cred, 'utf8')).toBe('lab-pass')
    expect(readFileSync(canary, 'utf8')).toContain('rocky tank canary')
    expect(execs.some((a) => a[0] === 'zpool' && a[1] === 'import')).toBe(true)
    expect(logs.some((l) => l.includes('tank-import: done'))).toBe(true)
  })
})
