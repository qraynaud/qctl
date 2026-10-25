import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import * as clientMod from '../../supervisor/client.js'
import { SupervisorUnavailableError } from '../../supervisor/client.js'
import { callSecret } from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  clientMod.supervisorSecretRequest.mockRestore?.()
  process.exitCode = 0
})

/**
 * @param {string} dir
 * @param {{ adminUid?: number, appsUid?: number }} [uids]
 */
function writeOsConfig(dir, uids = {}) {
  const cfg = join(dir, 'config.json')
  writeFileSync(
    cfg,
    JSON.stringify({
      env: 'dev',
      root: dir,
      repo: { vcs: 'hg' },
      quadletUser: 'apps',
      apps: {
        username: 'apps',
        uid: uids.appsUid ?? 900,
        gid: 900,
        subuid: { start: 1, count: 1 },
        subgid: { start: 1, count: 1 },
      },
      admin: { username: 'admin', uid: uids.adminUid ?? 1000, gid: 1000 },
      timezone: 'UTC',
      profile: 'appliance',
    }),
  )
  return cfg
}

describe('secret rpc', () => {
  test('admin uses admin.sock; maps exitCode', async () => {
    const dir = makeTempDir()
    const cfg = writeOsConfig(dir, { adminUid: process.getuid?.() ?? 0 })
    const spy = spyOn(clientMod, 'supervisorSecretRequest').mockImplementation(async () => ({
      ok: /** @type {const} */ (true),
      result: { method: /** @type {const} */ ('secret'), exitCode: 3 },
    }))

    await callSecret({ op: 'sync', restart: true }, { osConfigPath: cfg, runDir: join(dir, 'run') })

    expect(spy).toHaveBeenCalled()
    const [sock, req] = spy.mock.calls[0]
    expect(String(sock)).toContain('admin.sock')
    expect(req).toMatchObject({ method: 'secret', params: { op: 'sync', restart: true } })
    expect(process.exitCode).toBe(3)
  })

  test('apps uid requires --app and uses apps.sock; rejects restart', async () => {
    const dir = makeTempDir()
    const uid = process.getuid?.() ?? 900
    const cfg = writeOsConfig(dir, { appsUid: uid, adminUid: uid + 1 })
    const spy = spyOn(clientMod, 'supervisorSecretRequest').mockImplementation(async () => ({
      ok: /** @type {const} */ (true),
      result: { method: /** @type {const} */ ('secret'), exitCode: 0 },
    }))

    await callSecret({ op: 'sync' }, { osConfigPath: cfg, runDir: join(dir, 'run') })
    expect(spy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await callSecret(
      { op: 'sync', app: 'web', restart: true },
      { osConfigPath: cfg, runDir: join(dir, 'run') },
    )
    expect(spy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await callSecret({ op: 'sync', app: 'web' }, { osConfigPath: cfg, runDir: join(dir, 'run') })
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('apps.sock')
  })

  test('maps unavailable supervisor to exit 1', async () => {
    const dir = makeTempDir()
    const cfg = writeOsConfig(dir, { adminUid: process.getuid?.() ?? 0 })
    spyOn(clientMod, 'supervisorSecretRequest').mockImplementation(async () => {
      throw new SupervisorUnavailableError('/run/qctl/admin.sock')
    })

    await callSecret({ op: 'check' }, { osConfigPath: cfg, runDir: join(dir, 'run') })
    expect(process.exitCode).toBe(1)
  })

  test('random uid dies without calling supervisor', async () => {
    const dir = makeTempDir()
    const cfg = writeOsConfig(dir, { adminUid: 1000, appsUid: 900 })
    const spy = spyOn(clientMod, 'supervisorSecretRequest').mockImplementation(async () => ({
      ok: /** @type {const} */ (true),
      result: { method: /** @type {const} */ ('secret'), exitCode: 0 },
    }))
    const getuid = spyOn(process, 'getuid').mockReturnValue(42)
    try {
      await callSecret({ op: 'check' }, { osConfigPath: cfg, runDir: join(dir, 'run') })
      expect(spy).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    } finally {
      getuid.mockRestore()
    }
  })
})
