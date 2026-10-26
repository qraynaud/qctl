import {
  INTERFACE_TYPE,
  VM_ATTACH_MODE,
  VM_VLAN_MODE,
  alignedVmNics,
  dummyInterfaceNames,
  ethernetEntries,
  interfacesSchema,
  networkingSchema,
  normalizeInterfaceEntry,
  resolveParentIface,
  vlanEntries,
  vmVlanSchema,
} from './networking.js'
import { describe, expect, test } from 'bun:test'

const labPorts = {
  ssh: { port: 22, forward: 2222 },
}

describe('vmVlanSchema', () => {
  test('scalar id → access', () => {
    expect(vmVlanSchema.parse(10)).toEqual({ mode: VM_VLAN_MODE.ACCESS, ids: [10] })
  })

  test('range string → trunk', () => {
    expect(vmVlanSchema.parse('10-12')).toEqual({
      mode: VM_VLAN_MODE.TRUNK,
      ids: [10, 11, 12],
    })
  })

  test('list (incl. single-element) → trunk', () => {
    expect(vmVlanSchema.parse([10])).toEqual({ mode: VM_VLAN_MODE.TRUNK, ids: [10] })
    expect(vmVlanSchema.parse([2, '10-11', 2])).toEqual({
      mode: VM_VLAN_MODE.TRUNK,
      ids: [2, 10, 11],
    })
  })

  test('rejects bad ranges', () => {
    expect(() => vmVlanSchema.parse('20-10')).toThrow(/bad vlan range/)
  })
})

describe('normalizeInterfaceEntry', () => {
  test('defaults iface from label when IFACE_RE matches', () => {
    const e = normalizeInterfaceEntry('vlan2', { type: INTERFACE_TYPE.DUMMY })
    expect(e).toEqual({ type: INTERFACE_TYPE.DUMMY, iface: 'vlan2' })
  })

  test('requires iface when label is not a Linux iface name', () => {
    // Labels like `main` match IFACE_RE (iface defaults to the label); digit-leading does not.
    const e = normalizeInterfaceEntry('0wan', { type: INTERFACE_TYPE.ETHERNET })
    expect(e).toMatchObject({ error: expect.stringMatching(/iface is required/) })
  })

  test('label main defaults iface to main (override in YAML for eth0)', () => {
    expect(normalizeInterfaceEntry('main', { type: INTERFACE_TYPE.ETHERNET })).toEqual({
      type: INTERFACE_TYPE.ETHERNET,
      iface: 'main',
    })
  })

  test('strips vlan/vm fields when flipping to dummy', () => {
    const e = normalizeInterfaceEntry('vlan2', {
      type: INTERFACE_TYPE.DUMMY,
      id: 2,
      parent: 'main',
      vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr0' },
      ipv4: { dhcp: false, addresses: ['10.42.2.2/24'] },
    })
    expect(e).toEqual({
      type: INTERFACE_TYPE.DUMMY,
      iface: 'vlan2',
      ipv4: { dhcp: false, addresses: ['10.42.2.2/24'] },
    })
  })
})

describe('interfacesSchema', () => {
  test('prefault is main ethernet eth0 without dhcp', () => {
    const ifaces = interfacesSchema.parse(undefined)
    expect(ifaces).toEqual({
      main: { type: INTERFACE_TYPE.ETHERNET, iface: 'eth0' },
    })
  })

  test('iface defaults from label; ipv4.dhcp defaults false', () => {
    const ifaces = interfacesSchema.parse({
      eth0: { type: 'ethernet', ipv4: {} },
      vlan2: { type: 'dummy', ipv4: { addresses: '10.42.2.2/24' } },
    })
    expect(ifaces.eth0).toEqual({
      type: INTERFACE_TYPE.ETHERNET,
      iface: 'eth0',
      ipv4: { dhcp: false },
    })
    expect(ifaces.vlan2).toEqual({
      type: INTERFACE_TYPE.DUMMY,
      iface: 'vlan2',
      ipv4: { dhcp: false, addresses: ['10.42.2.2/24'] },
    })
  })

  test('rejects dhcp + static addresses', () => {
    expect(() =>
      interfacesSchema.parse({
        eth0: {
          type: 'ethernet',
          ipv4: { dhcp: true, addresses: '10.0.0.5/24' },
        },
      }),
    ).toThrow(/dhcp/)
  })

  test('vlan parent must be ethernet label; resolves helpers', () => {
    const ifaces = interfacesSchema.parse({
      main: { type: 'ethernet', iface: 'eth0' },
      apps: { type: 'vlan', id: 2, parent: 'main', iface: 'vlan2' },
    })
    expect(ifaces.apps).toMatchObject({
      type: INTERFACE_TYPE.VLAN,
      id: 2,
      parent: 'main',
      iface: 'vlan2',
    })
    expect(resolveParentIface(ifaces, 'main')).toBe('eth0')
    expect(ifaces.apps.type).toBe(INTERFACE_TYPE.VLAN)
    if (ifaces.apps.type !== INTERFACE_TYPE.VLAN) throw new Error('expected vlan')
    expect(vlanEntries(ifaces)).toEqual([['apps', ifaces.apps]])
  })

  test('rejects missing parent / non-ethernet parent / duplicate iface', () => {
    expect(() =>
      interfacesSchema.parse({
        main: { type: 'ethernet', iface: 'eth0' },
        apps: { type: 'vlan', id: 2, parent: 'missing', iface: 'vlan2' },
      }),
    ).toThrow(/parent/)

    expect(() =>
      interfacesSchema.parse({
        main: { type: 'ethernet', iface: 'eth0' },
        other: { type: 'dummy', iface: 'dum0' },
        apps: { type: 'vlan', id: 2, parent: 'other', iface: 'vlan2' },
      }),
    ).toThrow(/ethernet/)

    expect(() =>
      interfacesSchema.parse({
        a: { type: 'ethernet', iface: 'eth0' },
        b: { type: 'ethernet', iface: 'eth0' },
      }),
    ).toThrow(/already used/)
  })

  test('requires at least one ethernet', () => {
    expect(() =>
      interfacesSchema.parse({
        vlan2: { type: 'dummy' },
      }),
    ).toThrow(/ethernet/)
  })

  test('ethernet.vm access vs trunk + ipv6 accept-ra + nameservers', () => {
    const ifaces = interfacesSchema.parse({
      main: {
        type: 'ethernet',
        iface: 'eth0',
        ipv4: { dhcp: true },
        ipv6: { 'accept-ra': true, addresses: '2001:db8::5/64' },
        nameservers: ['1.1.1.1', '2001:db8::53', 'dns.google'],
        vm: { mode: 'bridge', bridge: 'vmbr0', vlan: 10, mac: 'aa:bb:cc:dd:ee:ff' },
      },
      trunked: {
        type: 'ethernet',
        iface: 'eth1',
        vm: { mode: 'bridge', bridge: 'br0', vlan: [2, '5-6'] },
      },
    })
    expect(ifaces.main.type).toBe(INTERFACE_TYPE.ETHERNET)
    expect(ifaces.trunked.type).toBe(INTERFACE_TYPE.ETHERNET)
    if (ifaces.main.type !== INTERFACE_TYPE.ETHERNET) throw new Error('expected ethernet')
    if (ifaces.trunked.type !== INTERFACE_TYPE.ETHERNET) throw new Error('expected ethernet')
    expect(ifaces.main.vm).toEqual({
      mode: VM_ATTACH_MODE.BRIDGE,
      bridge: 'vmbr0',
      vlan: { mode: VM_VLAN_MODE.ACCESS, ids: [10] },
      mac: 'AA:BB:CC:DD:EE:FF',
    })
    expect(ifaces.main.ipv6).toEqual({
      'accept-ra': true,
      addresses: ['2001:db8::5/64'],
    })
    expect(ifaces.main.nameservers).toEqual(['1.1.1.1', '2001:db8::53', 'dns.google'])
    expect(ifaces.trunked.vm).toEqual({
      mode: VM_ATTACH_MODE.BRIDGE,
      bridge: 'br0',
      vlan: { mode: VM_VLAN_MODE.TRUNK, ids: [2, 5, 6] },
    })
  })

  test('ethernet.vm mode nat', () => {
    const ifaces = interfacesSchema.parse({
      lab: { type: 'ethernet', iface: 'eth0', vm: { mode: 'nat' } },
    })
    expect(ifaces.lab.type === INTERFACE_TYPE.ETHERNET && ifaces.lab.vm).toEqual({
      mode: VM_ATTACH_MODE.NAT,
    })
  })

  test('ethernet.vm requires mode', () => {
    expect(() =>
      interfacesSchema.parse({
        main: { type: 'ethernet', iface: 'eth0', vm: { bridge: 'br0' } },
      }),
    ).toThrow()
  })

  test('rejects invalid nameserver', () => {
    expect(() =>
      interfacesSchema.parse({
        eth0: { type: 'ethernet', nameservers: ['not a host'] },
      }),
    ).toThrow()
  })

  test('dummy↔vlan type flip drops stale keys after merge-shaped input', () => {
    const ifaces = interfacesSchema.parse({
      main: { type: 'ethernet', iface: 'eth0' },
      vlan2: {
        type: 'dummy',
        id: 2,
        parent: 'main',
        ipv4: { addresses: ['10.42.2.2/24'] },
      },
    })
    expect(ifaces.vlan2).toEqual({
      type: INTERFACE_TYPE.DUMMY,
      iface: 'vlan2',
      ipv4: { dhcp: false, addresses: ['10.42.2.2/24'] },
    })
  })
})

describe('helpers', () => {
  test('alignedVmNics sorts by label and keeps vm', () => {
    const ifaces = interfacesSchema.parse({
      zeta: {
        type: 'ethernet',
        iface: 'eth1',
        vm: { mode: 'bridge', bridge: 'br1' },
      },
      alpha: { type: 'ethernet', iface: 'eth0' },
      vlan2: { type: 'dummy' },
    })
    expect(alignedVmNics(ifaces)).toEqual([
      { label: 'alpha', iface: 'eth0' },
      {
        label: 'zeta',
        iface: 'eth1',
        vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br1' },
      },
    ])
    expect(dummyInterfaceNames(ifaces)).toEqual(['vlan2'])
    expect(ethernetEntries(ifaces).map(([l]) => l)).toEqual(['alpha', 'zeta'])
  })
})

describe('networkingSchema', () => {
  test('parses ports + interfaces', () => {
    const n = networkingSchema.parse({
      ports: labPorts,
      interfaces: {
        main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
      },
    })
    expect(n.ports.ssh.port).toBe(22)
    expect(n.interfaces.main.ipv4?.dhcp).toBe(true)
  })
})
