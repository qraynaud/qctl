import { provisionSchema } from '../../../provision/schema/parse.js'
import { refineProvision } from './provision-refine.js'
import { describe, expect, test } from 'bun:test'

/** @import { z } from 'zod' */
/** @import { ProvisionBody } from '../../../provision/schema/parse.js' */

/**
 * @param {Record<string, unknown>} interfaces
 * @param {Record<string, unknown>} [extra]
 */
function parseWith(interfaces, extra = {}) {
  return provisionSchema.parse({
    networking: {
      ports: { ssh: { port: 22 } },
      interfaces,
    },
    ...extra,
  })
}

describe('refineProvision (trunk carriage)', () => {
  test('accepts guest vlan id on parent trunk', () => {
    const data = parseWith({
      main: {
        type: 'ethernet',
        iface: 'eth0',
        vm: { mode: 'bridge', bridge: 'vmbr0', vlan: [2, 10] },
      },
      apps: { type: 'vlan', id: 2, parent: 'main', iface: 'vlan2' },
    })
    expect(data.networking.interfaces.apps).toMatchObject({ id: 2, parent: 'main' })
  })

  test('rejects guest vlan id not on parent trunk', () => {
    expect(() =>
      parseWith({
        main: {
          type: 'ethernet',
          iface: 'eth0',
          vm: { mode: 'bridge', bridge: 'vmbr0', vlan: [2] },
        },
        apps: { type: 'vlan', id: 99, parent: 'main', iface: 'vlan99' },
      }),
    ).toThrow(/not carried on parent .*main.* trunk/)
  })

  test('access parent allows guest vlan (double-tag)', () => {
    const data = parseWith({
      main: {
        type: 'ethernet',
        iface: 'eth0',
        vm: { mode: 'bridge', bridge: 'vmbr0', vlan: 10 },
      },
      apps: { type: 'vlan', id: 2, parent: 'main', iface: 'vlan2' },
    })
    const { main, apps } = data.networking.interfaces
    expect(main.type === 'ethernet' && main.vm?.mode === 'bridge' && main.vm.vlan).toEqual({
      mode: 'access',
      ids: [10],
    })
    expect(apps.type === 'vlan' && apps.id).toBe(2)
  })

  test('no vm.vlan skips carriage (untagged / userspace)', () => {
    expect(() =>
      parseWith({
        main: {
          type: 'ethernet',
          iface: 'eth0',
          vm: { mode: 'bridge', bridge: 'vmbr0' },
        },
        apps: { type: 'vlan', id: 2, parent: 'main', iface: 'vlan2' },
      }),
    ).not.toThrow()

    expect(() =>
      parseWith({
        main: { type: 'ethernet', iface: 'eth0' },
        apps: { type: 'vlan', id: 2, parent: 'main', iface: 'vlan2' },
      }),
    ).not.toThrow()
  })

  test('omitted ethernet.vm is fine (optional host attach)', () => {
    const data = parseWith({
      main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
    })
    expect(
      data.networking.interfaces.main.type === 'ethernet' && data.networking.interfaces.main.vm,
    ).toBeUndefined()
  })

  test('direct refineProvision reports path on trunk miss', () => {
    /** @type {{ path?: PropertyKey[] }[]} */
    const issues = []
    refineProvision(
      /** @type {any} */ ({
        networking: {
          ports: { ssh: { port: 22 }, cockpit: { port: 9090 } },
          interfaces: {
            main: {
              type: 'ethernet',
              iface: 'eth0',
              vm: { mode: 'bridge', bridge: 'vmbr0', vlan: { mode: 'trunk', ids: [2] } },
            },
            apps: { type: 'vlan', id: 99, iface: 'vlan99', parent: 'main' },
          },
        },
      }),
      /** @type {any} */ ({
        /**
         * @param {{ path?: PropertyKey[] }} issue
         */
        addIssue(issue) {
          issues.push(issue)
        },
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toEqual(['networking', 'interfaces', 'apps', 'id'])
  })
})
