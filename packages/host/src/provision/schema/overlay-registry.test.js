import { getDriverModule, listDriverIds } from '../../vm/drivers/registry.js'
import { provisionSchema } from './parse.js'
import { describe, expect, test } from 'bun:test'

describe('provision overlays from driver registry', () => {
  test('builtin overlay schemas come from registered modules', () => {
    const ids = listDriverIds().map(String)
    expect(ids).toContain('workstation')
    expect(ids).toContain('proxmox')
    expect(getDriverModule('workstation')?.provisionOverlaySchema).toBeDefined()
    expect(getDriverModule('proxmox')?.provisionOverlaySchema).toBeDefined()
    expect(typeof getDriverModule('proxmox')?.refineProvision).toBe('function')
  })

  test('provisionSchema accepts workstation + proxmox overlays', () => {
    const data = provisionSchema.parse({
      networking: {
        ports: { ssh: { port: 22 } },
        uplinks: { eth0: { dhcp4: true } },
      },
      workstation: { cpu: 2, memory: 4096 },
      proxmox: { node: 'pve1' },
    })
    expect(data.workstation).toEqual({ cpu: 2, memory: 4096 })
    expect(data.proxmox?.node).toBe('pve1')
  })

  test('unknown top-level overlay key is rejected (strict)', () => {
    expect(() =>
      provisionSchema.parse({
        networking: {
          ports: { ssh: { port: 22 } },
          uplinks: { eth0: { dhcp4: true } },
        },
        otherHypervisor: { cpu: 1 },
      }),
    ).toThrow()
  })
})
