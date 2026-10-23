import { parseProvisionOrThrow, provisionSchema, qctlSchema } from './parse.js'
import { describe, expect, test } from 'bun:test'

const net = {
  networking: {
    ports: { ssh: { port: 22, forward: 2222 } },
    uplinks: { eth0: { dhcp4: true } },
  },
}

describe('qctlSchema', () => {
  test('defaults platform and built-in environments/profiles', () => {
    const q = qctlSchema.parse({})
    expect(q.platform).toBe('rocky')
    expect(q.environments.prod.production).toBe(true)
    expect(q.profiles.default).toEqual({ env: 'dev', target: 'workstation' })
    expect(q.defaultProfile).toBe('default')
  })

  test('renames default-profile and validates profile env', () => {
    const q = qctlSchema.parse({
      platform: 'rocky',
      environments: {
        dev: {},
        prod: { production: true },
      },
      profiles: {
        lab: { env: 'dev', target: 'workstation' },
        prod: { env: 'prod', target: 'proxmox' },
      },
      'default-profile': 'lab',
    })
    expect(q.defaultProfile).toBe('lab')
    expect(q.profiles.prod.target).toBe('proxmox')
  })

  test('rejects profile.env outside environments', () => {
    expect(() =>
      qctlSchema.parse({
        environments: { dev: {} },
        profiles: { lab: { env: 'missing', target: 'workstation' } },
      }),
    ).toThrow(/not in qctl.environments/)
  })
})

describe('provisionSchema qctl', () => {
  test('merged document gets qctl host-meta defaults', () => {
    const data = provisionSchema.parse({ ...net })
    expect(data.qctl.platform).toBe('rocky')
    expect(data.qctl.defaultProfile).toBe('default')
    expect(data.qctl.environments.dev.production).toBe(false)
  })

  test('parseProvisionOrThrow labels failures', () => {
    expect(() =>
      parseProvisionOrThrow(
        {
          ...net,
          qctl: {
            environments: { dev: {} },
            profiles: { lab: { env: 'nope', target: 'workstation' } },
          },
        },
        'env-dev.yaml',
      ),
    ).toThrow(/env-dev\.yaml/)
  })
})
