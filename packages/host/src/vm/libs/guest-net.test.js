import { renderNetworkConfigV2, vlanParentEnvLines } from './guest-net.js'
import { describe, expect, test } from 'bun:test'

describe('guest-net', () => {
  test('vlanParentEnvLines emits VLAN parent and ipv4', () => {
    expect(vlanParentEnvLines([{ name: 'vlan2', ipv4: '10.0.2.2' }, { name: 'other' }])).toEqual([
      'VLAN2_PARENT=vlan2',
      'VLAN2_IPV4=10.0.2.2',
    ])
  })

  test('renderNetworkConfigV2 emits ethernets only', () => {
    const yaml = renderNetworkConfigV2(
      [{ name: 'eth0', dhcp4: true }],
      [{ name: 'vlan2', id: 2, link: 'eth0' }],
    )
    expect(yaml).toMatch(/version: 2/)
    expect(yaml).toMatch(/eth0:/)
    expect(yaml).toMatch(/dhcp4: true/)
    expect(yaml).not.toMatch(/vlans:/)
  })
})
