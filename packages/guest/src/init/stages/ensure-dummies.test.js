import { packagesMapWithRequired } from '@qctl/shared'

import { createTestContext } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import ensureDummies from './ensure-dummies.js'
import { describe, expect, test } from 'bun:test'

const stubPackages = packagesMapWithRequired()

describe('ensure-dummies stage', () => {
  test('plan lists type:dummy ifaces', () => {
    const ctx = createTestContext({
      log: () => {},
      interfaces: {
        main: { type: 'ethernet', iface: 'eth0' },
        vlan2: { type: 'dummy', iface: 'vlan2' },
        lab: { type: 'dummy', iface: 'lab0' },
      },
      platform: {
        id: 'fake',
        packages: stubPackages,
        installPackages: async () => {},
      },
    })
    expect(ensureDummies.plan(ctx)).toEqual([
      'ensure dummy ifaces: lab0, vlan2',
      'install qctl-ensure-dummies.service (every boot)',
    ])
  })

  test('plan when no dummies', () => {
    const ctx = createTestContext({
      log: () => {},
      interfaces: { main: { type: 'ethernet', iface: 'eth0' } },
    })
    expect(ensureDummies.plan(ctx)[0]).toMatch(/no type:dummy/)
  })

  test('run requires root', async () => {
    const ctx = createTestContext({
      log: () => {},
      isRoot: () => false,
    })
    await expect(ensureDummies.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
