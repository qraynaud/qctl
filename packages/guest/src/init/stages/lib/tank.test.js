import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createContext } from '../../context.js'
import { ensureTankPassphraseFromBootstrap, installTankPassphrase, tankCredFile } from './tank.js'
import { describe, expect, test } from 'bun:test'

describe('ensureTankPassphraseFromBootstrap', () => {
  test('reseeds from Tier-0 env when key file missing', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tank-pass-'))
    const cred = join(base, 'tank_passphrase')

    const ctx = createContext({
      env: {
        QCTL_ENV: 'dev',
        TANK_PASSPHRASE: 'lab-pass',
        ROCKY_TANK_CRED_FILE: cred,
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
})
