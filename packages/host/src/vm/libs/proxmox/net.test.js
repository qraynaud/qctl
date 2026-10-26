import { VM_ATTACH_MODE, VM_VLAN_MODE } from '../../../provision/schema/networking.js'
import {
  applyNetsToForm,
  applyNicsSpecToForm,
  formatNet,
  formatNetsLabel,
  mergeNetPreserveMac,
  nicsSpecToAligned,
  normalizeMac,
  summarizeVlans,
} from './net.js'
import { describe, expect, test } from 'bun:test'

describe('proxmox net', () => {
  test('normalizeMac accepts colon and bare hex', () => {
    expect(normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF')
    expect(normalizeMac('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF')
    expect(normalizeMac('nope')).toBeNull()
  })

  test('summarizeVlans collapses ranges', () => {
    expect(summarizeVlans([10, 20, 30, 31, 32, 40])).toBe('10,20,30-32,40')
  })

  test('formatNet and applyNetsToForm', () => {
    expect(formatNet({ bridge: 'vmbr1', vlan: { mode: VM_VLAN_MODE.ACCESS, ids: [10] } })).toBe(
      'virtio,bridge=vmbr1,tag=10',
    )
    expect(formatNet({ bridge: 'vmbr0', vlan: { mode: VM_VLAN_MODE.TRUNK, ids: [2, 5] } })).toBe(
      'virtio,bridge=vmbr0,trunks=2;5',
    )
    /** @type {Record<string, string>} */
    const form = {}
    expect(applyNetsToForm(form, [{ bridge: 'vmbr0', mac: 'aa:bb:cc:dd:ee:ff' }])).toBe(1)
    expect(form.net0).toMatch(/virtio=AA:BB:CC:DD:EE:FF/)
    expect(
      applyNetsToForm(form, [
        {
          label: 'main',
          iface: 'eth0',
          vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr1', mac: '11:22:33:44:55:66' },
        },
      ]),
    ).toBe(1)
    expect(form.net0).toMatch(/bridge=vmbr1/)
    expect(applyNetsToForm({}, [])).toBe(0)
    expect(applyNetsToForm({}, undefined)).toBe(0)
  })

  test('applyNicsSpecToForm sorts by label', () => {
    /** @type {Record<string, string>} */
    const form = {}
    expect(
      applyNicsSpecToForm(form, {
        zed: { iface: 'eth1', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr1' },
        main: {
          iface: 'eth0',
          mode: VM_ATTACH_MODE.BRIDGE,
          bridge: 'vmbr0',
          mac: 'aa:bb:cc:dd:ee:ff',
        },
      }),
    ).toBe(2)
    expect(form.net0).toMatch(/bridge=vmbr0/)
    expect(form.net1).toMatch(/bridge=vmbr1/)
    expect(
      nicsSpecToAligned({
        zed: { iface: 'e', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'b' },
        main: { iface: 'e0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'b0' },
      })[0].label,
    ).toBe('main')
  })

  test('formatNetsLabel and mergeNetPreserveMac', () => {
    expect(formatNetsLabel([])).toBe('no host NICs')
    expect(
      formatNetsLabel([{ bridge: 'vmbr0', vlan: { mode: VM_VLAN_MODE.ACCESS, ids: [5] } }]),
    ).toMatch(/vlan 5/)
    expect(
      mergeNetPreserveMac('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0', 'virtio,bridge=vmbr1'),
    ).toBe('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr1')
  })
})
