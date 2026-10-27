import { applianceExecEnv } from './exec-in.js'
import { describe, expect, test } from 'bun:test'

describe('applianceExecEnv', () => {
  test('builds guest qctl env for podman exec (no path overrides)', () => {
    const env = applianceExecEnv({
      env: 'prod',
      platformBasename: 'qctl-platform-rocky.mjs',
      name: 'qctl-local-x',
      root: '/tmp',
      repoDir: '/tank/rocky',
      diskMounts: [],
      appsUsername: 'apps',
      appsUid: 900,
      appsGid: 900,
      appsSubuid: { start: 900000, count: 65536 },
      appsSubgid: { start: 900000, count: 65536 },
      adminUsername: 'admin',
      adminUid: 1000,
      adminGid: 1000,
      repo: { vcs: 'git' },
      guestBin: '/x',
      encryptPath: null,
      platformModulePath: '/x',
      image: 'img',
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
      dummyIfaces: [],
      publishArgs: [],
      uidMapArgs: [],
    })
    expect(env.QCTL_ENV).toBeUndefined()
    expect(env.QCTL_ROOT).toBeUndefined()
    expect(env.APP_ROOT).toBeUndefined()
    expect(env.TANK_ROOT).toBeUndefined()
    expect(env.QCTL_PLATFORM_MODULE).toBe('/usr/local/lib/qctl/qctl-platform-rocky.mjs')
    expect(env.CONTAINERS_LOG_LEVEL).toBe('fatal')
  })
})
