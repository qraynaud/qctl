import { DEFAULT_TANK_OPTIONS, diskMounts, disksSchema } from './disks.js'
import { resolveDisks } from './resolve-disks.js'
import { beforeEach, describe, expect, test } from 'bun:test'

const rockyPlatform = {
  filesystems: /** @type {const} */ (['xfs', 'ext4']),
  defaultFs: 'xfs',
  osDisk: { id: 'os', size: '20G' },
}

beforeEach(() => {
  diskMounts.clear()
})

describe('resolveDisks', () => {
  test('omitted disks.os → platform osDisk; data fs → defaultFs', () => {
    const disks = disksSchema.parse({
      data: { vw: { mount: '/vw', size: '2G' } },
    })
    const r = resolveDisks(disks, rockyPlatform)
    expect(r.os).toEqual({ id: 'os', size: '20G' })
    expect(r.data.vw).toEqual({ id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' })
    expect(r.tanks).toEqual({})
    expect(r.encryptedTankIds).toEqual([])
    expect(r.members).toEqual([
      { id: 'os', kind: 'os', size: '20G' },
      { id: 'vw', kind: 'data', owner: 'vw', size: '2G' },
    ])
  })

  test('omitted disks entirely → platform os only (no topology yet)', () => {
    const r = resolveDisks(undefined, rockyPlatform)
    expect(r.os).toEqual({ id: 'os', size: '20G' })
    expect(r.data).toEqual({})
    expect(r.tanks).toEqual({})
    expect(r.members).toEqual([{ id: 'os', kind: 'os', size: '20G' }])
    expect(r.encryptedTankIds).toEqual([])
  })

  test('honours explicit os, data.fs, and collects tank members + encrypted ids', () => {
    const disks = disksSchema.parse({
      os: { id: 'serial-os', size: '40G' },
      data: {
        vw: { mount: '/vw', fs: 'ext4', size: '2G' },
        cache: { mount: '/cache' },
      },
      tanks: {
        tank: {
          mount: '/tank',
          passphrase: 'secret',
          vdevs: {
            data0: {
              role: 'data',
              type: 'mirror',
              members: {
                a: { size: '10G' },
                b: { size: '10G' },
              },
            },
            special0: {
              role: 'special',
              type: 'single',
              members: { s: { size: '1G' } },
            },
          },
        },
        cold: {
          id: 'cold-pool',
          mount: '/cold',
          vdevs: {
            data0: {
              role: 'data',
              type: 'single',
              members: { c0: {} },
            },
          },
        },
      },
    })
    const r = resolveDisks(disks, rockyPlatform)
    expect(r.os).toEqual({ id: 'serial-os', size: '40G' })
    expect(r.data.vw.fs).toBe('ext4')
    expect(r.data.cache).toEqual({ id: 'cache', mount: '/cache', fs: 'xfs' })
    expect(r.tanks.tank.options).toEqual({
      pool: { ...DEFAULT_TANK_OPTIONS.pool },
      dataset: { ...DEFAULT_TANK_OPTIONS.dataset },
      acl: { ...DEFAULT_TANK_OPTIONS.acl },
    })
    expect(r.tanks.tank.passphrase).toBe('secret')
    expect(r.tanks.cold.id).toBe('cold-pool')
    expect(r.encryptedTankIds).toEqual(['tank'])
    expect(r.members).toEqual([
      { id: 'serial-os', kind: 'os', size: '40G' },
      { id: 'vw', kind: 'data', owner: 'vw', size: '2G' },
      { id: 'cache', kind: 'data', owner: 'cache' },
      { id: 'a', kind: 'tank', owner: 'tank', role: 'data', size: '10G' },
      { id: 'b', kind: 'tank', owner: 'tank', role: 'data', size: '10G' },
      { id: 's', kind: 'tank', owner: 'tank', role: 'special', size: '1G' },
      { id: 'c0', kind: 'tank', owner: 'cold-pool', role: 'data' },
    ])
  })

  test('rejects data.fs outside platform FILESYSTEMS', () => {
    const disks = disksSchema.parse({
      data: { vw: { mount: '/vw', fs: 'zfs' } },
    })
    expect(() => resolveDisks(disks, rockyPlatform)).toThrow(/FILESYSTEMS/)
  })

  test('rejects bad platform defaults', () => {
    const disks = disksSchema.parse({ data: { vw: { mount: '/vw' } } })
    expect(() =>
      resolveDisks(disks, { filesystems: ['xfs'], defaultFs: 'ext4', osDisk: { size: '20G' } }),
    ).toThrow(/defaultFs/)
    expect(() =>
      resolveDisks(disks, {
        filesystems: ['xfs'],
        defaultFs: 'xfs',
        osDisk: /** @type {{ id?: string, size?: string }} */ (/** @type {unknown} */ (null)),
      }),
    ).toThrow(/osDisk/)
  })
})
