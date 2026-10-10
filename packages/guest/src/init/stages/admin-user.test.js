import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createContext } from '../context.js'
import adminUser from './admin-user.js'
import { describe, expect, test } from 'bun:test'

describe('admin-user stage', () => {
  test('key-only mode when ADMIN_* incomplete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-stage-'))
    const keys = join(dir, 'keys')
    writeFileSync(keys, 'ssh-ed25519 AAAA test@host\n')

    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const calls = []
    const ctx = createContext({
      env: {
        PATH: process.env.PATH,
        QCTL_ENV: 'dev',
        ROCKY_ADMIN_SSH_KEYS: keys,
        ROCKY_SUDOERS_DROPIN: join(dir, 'sudoers'),
      },
      log: (l) => logs.push(l),
      isRoot: () => true,
      exec: async (argv) => {
        calls.push(argv)
        if (argv[0] === 'visudo') return { code: 0, stdout: '', stderr: '' }
        if (argv[0] === 'bash' && argv[2]?.includes('admin-user-ensure')) {
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    await adminUser.run(ctx)
    expect(logs.some((l) => l.includes('key-only'))).toBe(true)
    expect(calls.some((a) => a.includes('admin-user-ensure') && a.includes('keyonly'))).toBe(true)
  })
})
