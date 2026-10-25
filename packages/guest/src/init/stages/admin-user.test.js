import * as fsp from 'node:fs/promises'

import { createTestContext, testOsConfig } from '../context.test-helpers.js'
import * as loadSeed from '../load-seed-config.js'
import adminUser from './admin-user.js'
import { describe, expect, spyOn, test } from 'bun:test'

/** @import { OsConfig } from '@qctl/shared' */

describe('admin-user stage', () => {
  test('key-only mode when ADMIN_* incomplete', async () => {
    /** @type {Map<string, string>} */
    const files = new Map()
    spyOn(fsp, 'writeFile').mockImplementation(async (p, data) => {
      files.set(String(p), String(data))
    })
    spyOn(fsp, 'mkdir').mockImplementation(async () => undefined)
    spyOn(fsp, 'chmod').mockImplementation(async () => undefined)
    /** @type {OsConfig[]} */
    const writtenOs = []
    spyOn(loadSeed, 'writeOsConfig').mockImplementation((os) => {
      writtenOs.push(os)
    })

    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const calls = []
    const ctx = createTestContext({
      osConfig: testOsConfig({ admin: { username: 'placeholder', uid: 1000, gid: 1000 } }),
      seedConfig: /** @type {any} */ ({ adminSshAuthorizedKeys: 'ssh-ed25519 AAAA test' }),
      paths: { adminKeys: '/mock/keys', sudoersDropin: '/mock/sudoers' },
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
    expect(calls.some((a) => a[0] === 'systemctl' && a.includes('try-restart'))).toBe(true)
    expect(logs.some((l) => l.includes('restarted qctl-supervisor'))).toBe(true)
    expect(files.get('/mock/sudoers')).toMatch(/NOPASSWD/)
    expect(ctx.osConfig.admin).toEqual({ username: 'admin', uid: 1000, gid: 1000 })
    expect(writtenOs.at(-1)?.admin).toEqual({ username: 'admin', uid: 1000, gid: 1000 })
  })
})
