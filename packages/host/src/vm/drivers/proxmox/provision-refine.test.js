import { provisionSchema } from '../../../provision/schema/parse.js'
import { describe, expect, test } from 'bun:test'

const baseNet = {
  networking: {
    ports: { ssh: { port: 22 } },
    uplinks: { eth0: { dhcp4: true } },
    vlans: {},
  },
}

describe('proxmox refineProvision (via provisionSchema)', () => {
  test('accepts matching proxmox.net and uplinks', () => {
    const data = provisionSchema.parse({
      ...baseNet,
      proxmox: {
        net: { eth0: { bridge: 'vmbr0' } },
      },
    })
    expect(data.proxmox?.net?.eth0).toBeDefined()
  })

  test('rejects proxmox.net key missing from uplinks', () => {
    expect(() =>
      provisionSchema.parse({
        ...baseNet,
        proxmox: {
          net: { eth1: { bridge: 'vmbr0' } },
        },
      }),
    ).toThrow(/proxmox\.net key must match/)
  })

  test('rejects uplink without proxmox.net entry when net is set', () => {
    expect(() =>
      provisionSchema.parse({
        networking: {
          ports: { ssh: { port: 22 } },
          uplinks: {
            eth0: { dhcp4: true },
            eth1: { dhcp4: true },
          },
          vlans: {},
        },
        proxmox: {
          net: { eth0: { bridge: 'vmbr0' } },
        },
      }),
    ).toThrow(/matching proxmox\.net/)
  })
})
