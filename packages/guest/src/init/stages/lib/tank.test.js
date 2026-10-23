import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'

import { createContext } from '../../context.js'
import {
  ensureTankPassphraseFromBootstrap,
  installTankPassphrase,
  tankAssertZfsMounted,
  tankCredFile,
} from './tank.js'
import { describe, expect, spyOn, test } from 'bun:test'

/**
 * @returns {Map<string, string>}
 */
function mockCredFs() {
  /** @type {Map<string, string>} */
  const files = new Map()
  spyOn(fs, 'existsSync').mockImplementation((p) => files.has(String(p)))
  spyOn(fsp, 'mkdir').mockImplementation(async () => undefined)
  spyOn(fsp, 'writeFile').mockImplementation(async (p, data) => {
    files.set(String(p), String(data))
  })
  spyOn(fsp, 'chmod').mockImplementation(async () => undefined)
  // @ts-expect-error test stub returns utf8 string
  spyOn(fsp, 'readFile').mockImplementation(async (/** @type {string} */ p) => {
    const key = String(p)
    const body = files.get(key)
    if (body === undefined) {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error(`ENOENT: ${key}`))
      err.code = 'ENOENT'
      throw err
    }
    return body
  })
  return files
}

describe('ensureTankPassphraseFromBootstrap', () => {
  test('reseeds from Tier-0 env when key file missing', async () => {
    const files = mockCredFs()
    const cred = '/mock/tank_passphrase'

    const ctx = createContext({
      env: {
        QCTL_ENV: 'dev',
        tank_passphrase_tank: 'lab-pass',
        ROCKY_TANK_CRED_FILE: cred,
        QCTL_ZFS_POOL: 'tank',
      },
      log: () => {},
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })

    await ensureTankPassphraseFromBootstrap(ctx, 'tank-import')
    expect(files.get(cred)).toBe('lab-pass')
  })

  test('keeps existing key file without loading graph', async () => {
    const files = mockCredFs()
    const cred = '/mock/tank_passphrase'
    files.set(cred, 'keep-me')

    /** @type {string[]} */
    const logs = []
    const ctx = createContext({
      env: {
        QCTL_BOOTSTRAP_DIR: '/mock/missing',
        ROCKY_TANK_CRED_FILE: cred,
      },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })

    expect(tankCredFile(ctx)).toBe(cred)
    await ensureTankPassphraseFromBootstrap(ctx, 'tank-import')
    expect(files.get(cred)).toBe('keep-me')
    expect(logs.some((l) => l.includes('already present'))).toBe(true)
  })

  test('installTankPassphrase writes 0400 file', async () => {
    const files = mockCredFs()
    const cred = '/mock/subdir/tank_passphrase'
    const ctx = createContext({
      env: { ROCKY_TANK_CRED_FILE: cred },
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    await installTankPassphrase(ctx, 'secret')
    expect(files.get(cred)).toBe('secret')
    expect(fsp.chmod).toHaveBeenCalledWith(cred, 0o400)
  })

  test('reseeds per-pool tank_passphrase_<poolId> into credstore', async () => {
    const files = mockCredFs()
    const base = '/mock/credstore'
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
    expect(cred).toBe(`${base}/tank_passphrase_cold`)
    expect(files.get(cred)).toBe('cold-secret')
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
