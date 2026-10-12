import {
  applyNetsToForm,
  formatNet,
  formatNetsLabel,
  mergeNetPreserveMac,
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
    expect(formatNet({ bridge: 'vmbr1', vlan: 10 })).toBe('virtio,bridge=vmbr1,tag=10')
    /** @type {Record<string, string>} */
    const form = {}
    expect(applyNetsToForm(form, [{ bridge: 'vmbr0', mac: 'aa:bb:cc:dd:ee:ff' }])).toBe(1)
    expect(form.net0).toMatch(/virtio=AA:BB:CC:DD:EE:FF/)
  })

  test('formatNetsLabel and mergeNetPreserveMac', () => {
    expect(formatNetsLabel([{ bridge: 'vmbr0', vlan: 5 }])).toMatch(/vlan 5/)
    expect(
      mergeNetPreserveMac('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0', 'virtio,bridge=vmbr1'),
    ).toBe('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr1')
  })
})
