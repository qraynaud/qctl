import * as diskHolder from './disk-holder.js'
import { destroyRockyVm, waitUntilVmStopped } from './vm-lifecycle.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ProxmoxClient } from './client.js' */

afterEach(() => {
  // @ts-expect-error restore
  diskHolder.destroyHolder.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('vm-lifecycle', () => {
  test('waitUntilVmStopped returns when status is stopped', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const client = {
      qemuStatus: async () => ({ status: 'stopped' }),
    }
    await waitUntilVmStopped(/** @type {ProxmoxClient} */ (/** @type {never} */ (client)), 101, {
      timeoutSec: 5,
      name: 'rocky-dev',
    })
  })

  test('destroyRockyVm keep=none deletes VM and holder', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const destroyHolder = spyOn(diskHolder, 'destroyHolder').mockResolvedValue(undefined)
    /** @type {string[]} */
    const calls = []
    const client = {
      config: { node: 'pve', storage: 'local-lvm' },
      qemuStatus: async () => ({ status: 'stopped' }),
      qemuConfig: async () => ({
        scsi0: 'local-lvm:vm-101-disk-0',
        ide2: 'local:iso/seed.iso,media=cdrom',
      }),
      /**
       * @param {unknown} _schema
       * @param {string} path
       */
      put: async (_schema, path) => {
        calls.push(`put:${path}`)
      },
      /**
       * @param {unknown} _schema
       * @param {string} path
       */
      del: async (_schema, path) => {
        calls.push(`del:${path}`)
        return null
      },
      get: async () => [],
      deleteVolume: async () => {},
      waitTask: async () => {},
    }
    await destroyRockyVm(/** @type {ProxmoxClient} */ (/** @type {never} */ (client)), {
      vmid: 101,
      name: 'rocky-dev',
      keep: 'none',
    })
    expect(calls.some((c) => c.startsWith('del:'))).toBe(true)
    expect(destroyHolder).toHaveBeenCalledWith(client, 'rocky-dev')
  })
})
