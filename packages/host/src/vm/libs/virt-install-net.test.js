import { VM_ATTACH_MODE } from '../../provision/schema/networking.js'
import {
  injectInterfaceAliases,
  libvirtNicAlias,
  virtInstallBridgeNetworkArg,
  virtInstallNetworkArgv,
} from './virt-install-net.js'
import { describe, expect, test } from 'bun:test'

const ports = {
  ssh: { port: 22, forward: 2222 },
  cockpit: { port: 9090, forward: 9090 },
}

describe('virt-install-net', () => {
  test('libvirtNicAlias prefixes ua-', () => {
    expect(libvirtNicAlias('main')).toBe('ua-main')
    expect(libvirtNicAlias('apps/net')).toBe('ua-apps-net')
  })

  test('plan → --network in label order (bridge + nat)', () => {
    const argv = virtInstallNetworkArgv({
      nics: {
        zed: { iface: 'eth1', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br1' },
        lab: { iface: 'eth2', mode: VM_ATTACH_MODE.NAT, mac: 'AA:BB:CC:DD:EE:FF' },
        main: {
          iface: 'eth0',
          mode: VM_ATTACH_MODE.BRIDGE,
          bridge: 'br0',
          mac: 'aa:bb:cc:dd:ee:ff',
        },
      },
      ports,
    })
    // label order: lab, main, zed
    expect(argv[0]).toBe('--network')
    expect(argv[1]).toMatch(/passt|user/)
    expect(argv[1]).toContain('mac=AA:BB:CC:DD:EE:FF')
    expect(argv[2]).toBe('--network')
    expect(argv[3]).toBe('bridge=br0,model=virtio,mac=aa:bb:cc:dd:ee:ff,target=eth0')
    expect(argv[4]).toBe('--network')
    expect(argv[5]).toBe('bridge=br1,model=virtio,target=eth1')
  })

  test('empty plan → one NAT (passt) fallback', () => {
    expect(virtInstallNetworkArgv({ nics: {}, ports })).toEqual([
      '--network',
      expect.stringMatching(/passt|user/),
    ])
    expect(virtInstallNetworkArgv({ ports })).toEqual([
      '--network',
      expect.stringMatching(/passt|user/),
    ])
  })

  test('injectInterfaceAliases inserts ua-LABEL', () => {
    const xml = `<domain>
  <devices>
    <interface type='bridge'>
      <source bridge='br0'/>
      <model type='virtio'/>
    </interface>
    <interface type='bridge'>
      <source bridge='br1'/>
    </interface>
  </devices>
</domain>`
    const out = injectInterfaceAliases(xml, ['main', 'zed'])
    expect(out).toContain("<alias name='ua-main'/>")
    expect(out).toContain("<alias name='ua-zed'/>")
  })

  test('virtInstallBridgeNetworkArg', () => {
    expect(
      virtInstallBridgeNetworkArg('main', {
        mode: VM_ATTACH_MODE.BRIDGE,
        bridge: 'br0',
        iface: 'eth0',
      }),
    ).toBe('bridge=br0,model=virtio,target=eth0')
  })
})
