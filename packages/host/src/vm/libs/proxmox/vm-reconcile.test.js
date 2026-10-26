import { reconcileRockyAppliance } from './vm-reconcile.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ProxmoxClient } from './client.js' */

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.warn.mockRestore?.()
})

describe('reconcileRockyAppliance', () => {
  test('puts baseline config when disks already present', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'warn').mockImplementation(() => {})
    /** @type {Record<string, string>} */
    const cfg = {
      scsi0: 'local-lvm:vm-101-disk-0',
      scsi1: 'local-lvm:vm-101-disk-1,serial=vw',
      scsi2: 'local-lvm:vm-101-data-0,serial=rocky-data0',
      tags: 'qctl.installed=true;lab',
    }
    /** @type {{ path: string, form: Record<string, string> }[]} */
    const puts = []
    const client = {
      config: {
        node: 'pve',
        storage: 'local-lvm',
        nets: [
          {
            label: 'main',
            iface: 'eth0',
            vm: { mode: 'bridge', bridge: 'vmbr0' },
          },
        ],
      },
      qemuStatus: async () => ({ status: 'stopped' }),
      qemuConfig: async () => cfg,
      /**
       * @param {unknown} _schema
       * @param {string} path
       * @param {Record<string, string>} form
       */
      put: async (_schema, path, form) => {
        puts.push({ path, form })
      },
      waitTask: async () => {},
      post: async () => null,
    }
    const r = await reconcileRockyAppliance(
      /** @type {ProxmoxClient} */ (/** @type {never} */ (client)),
      {
        vmid: 101,
        name: 'rocky-dev',
        memory: 4096,
        vcpus: 2,
        disks: [
          { id: 'vw', mode: 'virtual', kind: 'data', size: '10G' },
          { id: 'rocky-data0', mode: 'virtual', kind: 'tank', size: '1G' },
        ],
      },
    )
    expect(r).toEqual({ vmid: 101 })
    expect(puts.length).toBeGreaterThan(0)
    const last = puts.at(-1)
    expect(last?.form.machine).toBe('q35')
    expect(last?.form.memory).toBe('4096')
    expect(last?.form.tpmstate0).toBe('local-lvm:1,version=v2.0')
    expect(String(last?.form.tags)).toMatch(/qctl\.installed=true/)
  })

  test('keeps existing tpmstate0 and does not delete it as cruft', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'warn').mockImplementation(() => {})
    /** @type {Record<string, string>} */
    const cfg = {
      scsi0: 'local-lvm:vm-101-disk-0',
      scsi1: 'local-lvm:vm-101-disk-1,serial=vw',
      scsi2: 'local-lvm:vm-101-data-0,serial=rocky-data0',
      tpmstate0: 'local-lvm:vm-101-disk-9,size=4M,version=v2.0',
    }
    /** @type {{ path: string, form: Record<string, string> }[]} */
    const puts = []
    const client = {
      config: {
        node: 'pve',
        storage: 'local-lvm',
        nets: [
          {
            label: 'main',
            iface: 'eth0',
            vm: { mode: 'bridge', bridge: 'vmbr0' },
          },
        ],
      },
      qemuStatus: async () => ({ status: 'stopped' }),
      qemuConfig: async () => cfg,
      /**
       * @param {unknown} _schema
       * @param {string} path
       * @param {Record<string, string>} form
       */
      put: async (_schema, path, form) => {
        puts.push({ path, form })
      },
      waitTask: async () => {},
      post: async () => null,
    }
    await reconcileRockyAppliance(/** @type {ProxmoxClient} */ (/** @type {never} */ (client)), {
      vmid: 101,
      name: 'rocky-dev',
      memory: 4096,
      vcpus: 2,
      disks: [
        { id: 'vw', mode: 'virtual', kind: 'data', size: '10G' },
        { id: 'rocky-data0', mode: 'virtual', kind: 'tank', size: '1G' },
      ],
    })
    expect(puts.some((p) => p.form.delete && String(p.form.delete).includes('tpmstate0'))).toBe(
      false,
    )
    const last = puts.at(-1)
    expect(last?.form.tpmstate0).toBeUndefined()
  })
})
