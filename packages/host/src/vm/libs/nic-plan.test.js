import { VM_ATTACH_MODE, VM_VLAN_MODE } from '../../provision/schema/networking.js'
import { bridgedNicsSorted, endpointNetworkFromNics, hasNatNic, toVmNicsSpec } from './nic-plan.js'
import { describe, expect, test } from 'bun:test'

describe('toVmNicsSpec', () => {
  test('maps ethernet.vm by label; omit vm → no hypervisor NIC', () => {
    expect(
      toVmNicsSpec({
        zed: {
          type: 'ethernet',
          iface: 'eth1',
          vm: {
            mode: VM_ATTACH_MODE.BRIDGE,
            bridge: 'br1',
            vlan: { mode: VM_VLAN_MODE.ACCESS, ids: [10] },
          },
        },
        main: { type: 'ethernet', iface: 'eth0' },
        lab: { type: 'ethernet', iface: 'eth2', vm: { mode: VM_ATTACH_MODE.NAT } },
        vlan2: { type: 'dummy', iface: 'vlan2' },
      }),
    ).toEqual({
      zed: {
        iface: 'eth1',
        mode: VM_ATTACH_MODE.BRIDGE,
        bridge: 'br1',
        vlan: { mode: VM_VLAN_MODE.ACCESS, ids: [10] },
      },
      lab: { iface: 'eth2', mode: VM_ATTACH_MODE.NAT },
    })
  })

  test('parsed bridge vm → plan with mode', async () => {
    const { interfacesSchema } = await import('../../provision/schema/networking.js')
    const ifaces = interfacesSchema.parse({
      main: {
        type: 'ethernet',
        iface: 'eth0',
        vm: { mode: 'bridge', bridge: 'br0' },
      },
    })
    expect(toVmNicsSpec(ifaces)).toEqual({
      main: { iface: 'eth0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br0' },
    })
  })

  test('bridgedNicsSorted is label order and skips nat', () => {
    expect(
      bridgedNicsSorted({
        zed: { iface: 'eth1', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br1' },
        main: { iface: 'eth0', mode: VM_ATTACH_MODE.NAT },
        apps: { iface: 'eth2', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br0' },
      }).map(([l]) => l),
    ).toEqual(['apps', 'zed'])
  })

  test('hasNatNic', () => {
    expect(hasNatNic({ a: { iface: 'eth0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br0' } })).toBe(
      false,
    )
    expect(hasNatNic({ a: { iface: 'eth0', mode: VM_ATTACH_MODE.NAT } })).toBe(true)
  })

  test('endpointNetworkFromNics', () => {
    expect(endpointNetworkFromNics(undefined)).toBe('user')
    expect(endpointNetworkFromNics({})).toBe('user')
    expect(endpointNetworkFromNics({ a: { iface: 'eth0', mode: VM_ATTACH_MODE.NAT } })).toBe('user')
    expect(
      endpointNetworkFromNics({
        a: { iface: 'eth0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br0' },
      }),
    ).toBe('default')
  })
})
