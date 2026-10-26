import { cpuSchema, memorySchema, proxmoxSchema, workstationSchema } from './targets.js'
import { describe, expect, test } from 'bun:test'

describe('target schemas', () => {
  test('cpuSchema and memorySchema require numbers and bound', () => {
    expect(cpuSchema.parse(4)).toBe(4)
    expect(() => cpuSchema.parse('4')).toThrow()
    expect(() => cpuSchema.parse(0)).toThrow()
    expect(memorySchema.parse(512)).toBe(512)
    expect(() => memorySchema.parse(128)).toThrow()
  })

  test('workstationSchema accepts optional resources', () => {
    expect(workstationSchema.parse({ cpu: 2, memory: 4096 })).toEqual({ cpu: 2, memory: 4096 })
    expect(() => workstationSchema.parse({ cpu: 2, unknown: true })).toThrow()
  })

  test('proxmoxSchema accepts api fields', () => {
    const p = proxmoxSchema.parse({
      api_url: 'https://pve.example',
      node: 'pve1',
      cpu: 2,
    })
    expect(p.api_url).toBe('https://pve.example')
    expect(p.node).toBe('pve1')
    expect(p.cpu).toBe(2)
    expect(() => proxmoxSchema.parse({ node: 'pve1', extra: 1 })).toThrow()
  })

  test('proxmoxSchema rejects legacy net (moved to interfaces.*.vm)', () => {
    expect(() =>
      proxmoxSchema.parse({
        node: 'pve1',
        net: { eth0: { bridge: 'vmbr0' } },
      }),
    ).toThrow()
  })
})
