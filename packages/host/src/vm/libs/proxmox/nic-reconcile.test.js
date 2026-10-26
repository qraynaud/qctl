import { VM_ATTACH_MODE } from '../../../provision/schema/networking.js'
import { nicsSpecToAligned } from './net.js'
import { putNetsOnForm, resolveAlignedNics, surplusNetKeys } from './nic-reconcile.js'
import { describe, expect, test } from 'bun:test'

/** @import { ProxmoxClient } from './client.js' */

describe('nicsSpecToAligned / resolveAlignedNics', () => {
  test('sorts labels → net order', () => {
    expect(
      nicsSpecToAligned({
        zed: { iface: 'eth1', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr1' },
        main: { iface: 'eth0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr0' },
      }).map((n) => n.label),
    ).toEqual(['main', 'zed'])
  })

  test('resolveAlignedNics prefers plan over client.config.nets; skips nat', () => {
    const client = {
      config: {
        nets: [
          {
            label: 'stale',
            iface: 'eth9',
            vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr9' },
          },
        ],
      },
    }
    const nets = resolveAlignedNics(
      /** @type {ProxmoxClient} */ (/** @type {unknown} */ (client)),
      {
        apps: { iface: 'eth0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr2' },
        lab: { iface: 'eth1', mode: VM_ATTACH_MODE.NAT },
      },
    )
    expect(nets).toEqual([
      {
        label: 'apps',
        iface: 'eth0',
        vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr2' },
      },
    ])
  })

  test('resolveAlignedNics empty plan → no NICs (no vmbr0 invent)', () => {
    const client = {
      config: {
        nets: [
          {
            label: 'stale',
            iface: 'eth9',
            vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr9' },
          },
        ],
      },
    }
    expect(
      resolveAlignedNics(/** @type {ProxmoxClient} */ (/** @type {unknown} */ (client)), {}),
    ).toEqual([])
    expect(
      resolveAlignedNics(/** @type {ProxmoxClient} */ (/** @type {unknown} */ (client)), []),
    ).toEqual([])
    expect(
      resolveAlignedNics(
        /** @type {ProxmoxClient} */ (/** @type {unknown} */ ({ config: { nets: [] } })),
        undefined,
      ),
    ).toEqual([])
  })
})

describe('putNetsOnForm / surplusNetKeys', () => {
  test('applies nets and lists surplus keys', () => {
    /** @type {Record<string, string>} */
    const form = {}
    const cfg = {
      net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
      net1: 'virtio,bridge=vmbr1',
      net2: 'virtio,bridge=vmbr2',
    }
    const count = putNetsOnForm(form, cfg, [
      {
        label: 'main',
        iface: 'eth0',
        vm: { mode: VM_ATTACH_MODE.BRIDGE, bridge: 'vmbr0' },
      },
    ])
    expect(count).toBe(1)
    expect(form.net0).toMatch(/virtio=AA:BB:CC:DD:EE:FF/)
    expect(surplusNetKeys(cfg, 1)).toEqual(['net1', 'net2'])
  })
})
