import {
  applyableInterfaceEntries,
  dummyIfaceNames,
  isVlanParentEnvKey,
  resolveParentIface,
  seedInterfacesSchema,
  vlanParentEnvLines,
  vlanParentsFromInterfaces,
} from './interfaces.js'
import { describe, expect, test } from 'bun:test'

describe('seedInterfacesSchema', () => {
  test('accepts ethernet/vlan/dummy without vm', () => {
    const out = seedInterfacesSchema.parse({
      main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
      apps: {
        type: 'vlan',
        iface: 'eth0.2',
        id: 2,
        parent: 'main',
        ipv4: { dhcp: false, addresses: ['10.0.2.10/24'] },
      },
      vlan2: { type: 'dummy', iface: 'vlan2' },
    })
    expect(out.main.type).toBe('ethernet')
    expect(out.apps).toMatchObject({ type: 'vlan', parent: 'main' })
  })

  test('rejects ethernet.vm (host-only)', () => {
    expect(() =>
      seedInterfacesSchema.parse({
        main: {
          type: 'ethernet',
          iface: 'eth0',
          vm: { bridge: 'vmbr0', model: 'virtio' },
        },
      }),
    ).toThrow()
  })
})

describe('resolveParentIface / applyableInterfaceEntries', () => {
  test('resolveParentIface returns ethernet iface', () => {
    const ifaces = {
      main: { type: /** @type {const} */ ('ethernet'), iface: 'eth0' },
      apps: {
        type: /** @type {const} */ ('vlan'),
        iface: 'eth0.2',
        id: 2,
        parent: 'main',
      },
    }
    expect(resolveParentIface(ifaces, 'main')).toBe('eth0')
    expect(resolveParentIface(ifaces, 'apps')).toBeUndefined()
  })

  test('applyableInterfaceEntries is ethernet then vlan; omits dummy', () => {
    const entries = applyableInterfaceEntries({
      vlan2: { type: 'dummy', iface: 'vlan2' },
      apps: { type: 'vlan', iface: 'eth0.2', id: 2, parent: 'main' },
      main: { type: 'ethernet', iface: 'eth0' },
    })
    expect(entries.map(([l]) => l)).toEqual(['main', 'apps'])
  })
})

describe('isVlanParentEnvKey', () => {
  test('VLAN{n}_PARENT / _IPV4 only', () => {
    expect(isVlanParentEnvKey('VLAN2_PARENT')).toBe(true)
    expect(isVlanParentEnvKey('VLAN10_IPV4')).toBe(true)
    expect(isVlanParentEnvKey('VLAN_FOO_PARENT')).toBe(false)
    expect(isVlanParentEnvKey('VLAN2_SUBNET')).toBe(false)
  })
})

describe('vlanParentEnvLines / dummyIfaceNames', () => {
  test('vlanParentEnvLines uses label for n and iface for PARENT', () => {
    const ifaces = {
      main: { type: /** @type {const} */ ('ethernet'), iface: 'eth0' },
      vlan2: {
        type: /** @type {const} */ ('dummy'),
        iface: 'vlan2',
        ipv4: { dhcp: false, addresses: ['10.0.2.2/24'] },
      },
    }
    expect(vlanParentEnvLines(ifaces)).toEqual(['VLAN2_IPV4=10.0.2.2', 'VLAN2_PARENT=vlan2'])
    expect(vlanParentsFromInterfaces(ifaces)).toEqual({
      VLAN2_PARENT: 'vlan2',
      VLAN2_IPV4: '10.0.2.2',
    })
  })

  test('vlanParentEnvLines PARENT follows iface remap', () => {
    const ifaces = {
      vlan2: {
        type: /** @type {const} */ ('dummy'),
        iface: 'lab2',
        ipv4: { dhcp: false, addresses: ['10.42.2.2/24'] },
      },
    }
    expect(vlanParentEnvLines(ifaces)).toEqual(['VLAN2_IPV4=10.42.2.2', 'VLAN2_PARENT=lab2'])
  })

  test('dummyIfaceNames sorted', () => {
    expect(
      dummyIfaceNames({
        b: { type: 'dummy', iface: 'dum-b' },
        a: { type: 'dummy', iface: 'dum-a' },
        e: { type: 'ethernet', iface: 'eth0' },
      }),
    ).toEqual(['dum-a', 'dum-b'])
  })
})
