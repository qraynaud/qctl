import { LOCAL_TANK_ROOT, applianceExecEnv } from './exec-in.js'
import { describe, expect, test } from 'bun:test'

describe('applianceExecEnv', () => {
  test('exports tank root constant', () => {
    expect(LOCAL_TANK_ROOT).toBe('/tank/rocky/volumes')
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
      guestBin: '/x',
      platformModulePath: '/x',
      image: 'img',
      ports: [],
      publishArgs: [],
      uidMapArgs: [],
    })
    expect(env.QCTL_ENV).toBe('prod')
    expect(env.QCTL_ROOT).toBe('/tank/rocky')
    expect(env.QCTL_PLATFORM_MODULE).toBe('/usr/local/lib/qctl/qctl-platform-rocky.mjs')
    expect(env.TANK_ROOT).toBe(LOCAL_TANK_ROOT)
  })
})
