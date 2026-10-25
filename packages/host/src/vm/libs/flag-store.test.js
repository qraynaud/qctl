/**
 * Both targets must expose the same {@link VmFlagStore} shape via `createFlagStore`.
 */
import { createFlagStore as createLibvirtStore } from './libvirt/flag-store.js'
import { createFlagStore as createProxmoxStore } from './proxmox/flag-store.js'
import { describe, expect, test } from 'bun:test'

const METHODS = ['delete', 'entry', 'get', 'has', 'set']

describe('VmFlagStore contract', () => {
  test('proxmox and libvirt factories return the same method surface', () => {
    const proxmox = createProxmoxStore(
      /** @type {any} */ ({
        config: { node: 'pve' },
        qemuConfig: async () => ({}),
        put: async () => {},
      }),
      1,
    )
    const libvirt = createLibvirtStore('qemu:///session', 'rocky')
    expect(Object.keys(proxmox).sort()).toEqual(METHODS)
    expect(Object.keys(libvirt).sort()).toEqual(METHODS)
  })
})
