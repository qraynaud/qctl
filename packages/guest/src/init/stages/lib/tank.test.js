import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createContext } from '../../context.js'
import {
  ensureTankPassphraseFromBootstrap,
  installTankPassphrase,
  tankAssertZfsMounted,
  tankCredFile,
} from './tank.js'
import { describe, expect, test } from 'bun:test'

describe('ensureTankPassphraseFromBootstrap', () => {
  test('reseeds from Tier-0 env when key file missing', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tank-pass-'))
    const cred = join(base, 'tank_passphrase')

    const ctx = createContext({
      env: {
        QCTL_ENV: 'dev',
        tank_passphrase_tank: 'lab-pass',
        ROCKY_TANK_CRED_FILE: cred,
        ROCKY_ZFS_POOL: 'tank',
      },
      log: () => {},
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })

    await ensureTankPassphraseFromBootstrap(ctx, 'tank-import')
    expect(existsSync(cred)).toBe(true)
    expect(readFileSync(cred, 'utf8')).toBe('lab-pass')
  })

  test('keeps existing key file without loading graph', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tank-pass-'))
    const cred = join(base, 'tank_passphrase')
    writeFileSync(cred, 'keep-me')

    /** @type {string[]} */
    const logs = []
    const ctx = createContext({
      env: {
        QCTL_BOOTSTRAP_DIR: join(base, 'missing'),
        ROCKY_TANK_CRED_FILE: cred,
      },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })

    expect(tankCredFile(ctx)).toBe(cred)
    await ensureTankPassphraseFromBootstrap(ctx, 'tank-import')
    expect(readFileSync(cred, 'utf8')).toBe('keep-me')
    expect(logs.some((l) => l.includes('already present'))).toBe(true)
  })

  test('installTankPassphrase writes 0400 file', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tank-pass-'))
    const cred = join(base, 'subdir', 'tank_passphrase')
    const ctx = createContext({
      env: { ROCKY_TANK_CRED_FILE: cred },
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    await installTankPassphrase(ctx, 'secret')
    expect(readFileSync(cred, 'utf8')).toBe('secret')
  })

  test('reseeds per-pool tank_passphrase_<poolId> into credstore', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tank-pass-'))
    const ctx = createContext({
      env: {
        ROCKY_CREDSTORE_DIR: base,
        tank_passphrase_cold: 'cold-secret',
      },
      log: () => {},
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    const cred = await ensureTankPassphraseFromBootstrap(ctx, 'tank-import', 'cold')
    expect(cred).toBe(join(base, 'tank_passphrase_cold'))
    expect(readFileSync(cred, 'utf8')).toBe('cold-secret')
  })
})

describe('tankAssertZfsMounted', () => {
  test('accepts findmnt zfs + mounted=yes', async () => {
    const ctx = createContext({
      env: {},
      log: () => {},
      exec: async (argv) => {
        if (argv[0] === 'findmnt') {
          return { code: 0, stdout: 'zfs tank /tank\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv.includes('mounted')) {
          return { code: 0, stdout: 'yes\n', stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'unexpected' }
      },
    })
    await tankAssertZfsMounted(ctx, 'tank', '/tank')
  })

  test('rejects when path is not a mountpoint', async () => {
    const ctx = createContext({
      env: {},
      log: () => {},
      exec: async (argv) => {
        if (argv[0] === 'findmnt') return { code: 1, stdout: '', stderr: '' }
        return { code: 0, stdout: 'yes\n', stderr: '' }
      },
    })
    await expect(tankAssertZfsMounted(ctx, 'tank', '/tank')).rejects.toThrow(/not a mountpoint/)
  })

  test('rejects when zfs mounted=no', async () => {
    const ctx = createContext({
      env: {},
      log: () => {},
      exec: async (argv) => {
        if (argv[0] === 'findmnt') {
          return { code: 0, stdout: 'zfs tank /tank\n', stderr: '' }
        }
        if (argv[0] === 'zfs' && argv.includes('mounted')) {
          return { code: 0, stdout: 'no\n', stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'unexpected' }
      },
    })
    await expect(tankAssertZfsMounted(ctx, 'tank', '/tank')).rejects.toThrow(/mounted/)
  })
})
