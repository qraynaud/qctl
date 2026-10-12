import {
  assertNameFreeForCreate,
  diskStateFromConfig,
  emptyDiskState,
  holderVmName,
} from './disk-holder.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ProxmoxClient } from './client.js' */

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('disk-holder', () => {
  test('holderVmName appends -disks', () => {
    expect(holderVmName('rocky-dev')).toBe('rocky-dev-disks')
  })

  test('emptyDiskState and diskStateFromConfig parse serials', () => {
    const empty = emptyDiskState(100)
    expect(empty.vw).toBeNull()
    expect(empty.data.every((d) => d == null)).toBe(true)

    const state = diskStateFromConfig(
      {
        scsi0: 'local-lvm:vm-100-disk-0',
        scsi1: 'local-lvm:vm-100-disk-1,serial=rocky-vw',
        scsi2: 'local-lvm:vm-100-disk-2,serial=rocky-data0',
        scsi3: 'local-lvm:vm-100-disk-3,serial=rocky-special0',
        ide2: 'local:iso/seed.iso,media=cdrom',
      },
      100,
    )
    expect(state.vw).toBe('local-lvm:vm-100-disk-1')
    expect(state.data[0]).toBe('local-lvm:vm-100-disk-2')
    expect(state.special[0]).toBe('local-lvm:vm-100-disk-3')
  })

  test('assertNameFreeForCreate dies when name exists', async () => {
    spyOn(process, 'exit').mockImplementation(
      /** @returns {never} */ () => {
        throw new Error('exit')
      },
    )
    spyOn(console, 'error').mockImplementation(() => {})
    const client = /** @type {ProxmoxClient} */ ({
      findVmidByName: async (name) => (name === 'rocky-dev' ? 101 : null),
    })
    await expect(assertNameFreeForCreate(client, 'rocky-dev')).rejects.toThrow(/exit/)
  })
})
