import { LOCAL_APP_ROOT, applianceExecEnv } from './exec-in.js'
import { describe, expect, test } from 'bun:test'

describe('applianceExecEnv', () => {
  test('exports app root constant', () => {
    expect(LOCAL_APP_ROOT).toBe('/tank/rocky/volumes')
  })

  test('builds guest qctl env for podman exec', () => {
    const env = applianceExecEnv({
      env: 'prod',
      platformBasename: 'qctl-platform-rocky.mjs',
      name: 'qctl-local-x',
      root: '/tmp',
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
    expect(env.QCTL_PLATFORM_MODULE).toBe('/usr/local/lib/qctl/qctl-platform-rocky.mjs')
    expect(env.APP_ROOT).toBe(LOCAL_APP_ROOT)
  })
})
