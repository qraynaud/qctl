import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir } from '@qctl/shared/test-helpers'

import * as clientMod from '../../supervisor/client.js'
import { SupervisorUnavailableError } from '../../supervisor/client.js'
import { argvApps, callQuadlet } from './rpc.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  clientMod.supervisorQuadletRequest.mockRestore?.()
  process.exitCode = 0
})

/** @param {string} dir */
function writeOsConfig(dir) {
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
        uid: 900,
        gid: 900,
        subuid: { start: 1, count: 1 },
        subgid: { start: 1, count: 1 },
      },
      admin: { username: 'admin', uid: process.getuid?.() ?? 0, gid: 1000 },
      timezone: 'UTC',
      profile: 'appliance',
    }),
  )
  return cfg
}

describe('quadlet rpc', () => {
  test('argvApps normalizes apps / app', () => {
    expect(argvApps({ apps: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(argvApps({ app: 'x' })).toEqual(['x'])
    expect(argvApps({})).toEqual([])
  })

  test('sends structured op to admin.sock', async () => {
    const dir = makeTempDir()
    const cfg = writeOsConfig(dir)
    const spy = spyOn(clientMod, 'supervisorQuadletRequest').mockImplementation(async () => ({
      ok: /** @type {const} */ (true),
      result: { method: /** @type {const} */ ('quadlet'), exitCode: 3 },
    }))

    await callQuadlet(
      { op: 'down', apps: ['web'] },
      { osConfigPath: cfg, runDir: join(dir, 'run') },
    )

    expect(spy).toHaveBeenCalled()
    const [sock, req] = spy.mock.calls[0]
    expect(String(sock)).toContain('admin.sock')
    expect(req).toMatchObject({ method: 'quadlet', params: { op: 'down', apps: ['web'] } })
    expect(process.exitCode).toBe(3)
  })

  test('maps unavailable supervisor to exit 1', async () => {
    const dir = makeTempDir()
    const cfg = writeOsConfig(dir)
    spyOn(clientMod, 'supervisorQuadletRequest').mockImplementation(async () => {
      throw new SupervisorUnavailableError('/run/qctl/admin.sock')
    })

    await callQuadlet({ op: 'ps' }, { osConfigPath: cfg, runDir: join(dir, 'run') })
    expect(process.exitCode).toBe(1)
  })

  test('non-admin uid dies without calling supervisor (no sudo hint)', async () => {
    const dir = makeTempDir()
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
          uid: 900,
          gid: 900,
          subuid: { start: 1, count: 1 },
          subgid: { start: 1, count: 1 },
        },
        admin: { username: 'admin', uid: 1000, gid: 1000 },
        timezone: 'UTC',
        profile: 'appliance',
      }),
    )
    const spy = spyOn(clientMod, 'supervisorQuadletRequest').mockImplementation(async () => ({
      ok: /** @type {const} */ (true),
      result: { method: /** @type {const} */ ('quadlet'), exitCode: 0 },
    }))
    const getuid = spyOn(process, 'getuid').mockReturnValue(42)

    try {
      await callQuadlet({ op: 'ps' }, { osConfigPath: cfg, runDir: join(dir, 'run') })
      expect(spy).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    } finally {
      getuid.mockRestore()
    }
  })
})
