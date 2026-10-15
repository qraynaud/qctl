import { disksJsonSchema, disksPackageHints } from './disks-json.js'
import { describe, expect, test } from 'bun:test'

const sample = {
  os: { id: 'os', size: '20G' },
  data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
  tanks: {
    tank: {
      id: 'tank',
      mount: '/tank',
      options: {
        pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
        dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
        acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
      },
      vdevs: {
        data0: {
          role: 'data',
          type: 'single',
          members: { 'rocky-data0': { id: 'rocky-data0', size: '2G' } },
        },
      },
    },
  },
  members: [
    { id: 'os', kind: 'os', size: '20G' },
    { id: 'vw', kind: 'data', size: '2G', owner: 'vw' },
    { id: 'rocky-data0', kind: 'tank', size: '2G', owner: 'tank', role: 'data' },
  ],
  encryptedTankIds: ['tank'],
}

describe('disksJsonSchema', () => {
  test('accepts resolved guest payload', () => {
    const out = disksJsonSchema.parse(sample)
    expect(out.os.id).toBe('os')
    expect(out.tanks.tank.mount).toBe('/tank')
    expect(out.encryptedTankIds).toEqual(['tank'])
  })

  test('rejects passphrase on tank entries', () => {
    const bad = structuredClone(sample)
    // @ts-expect-error intentional
    bad.tanks.tank.passphrase = 'secret'
    expect(() => disksJsonSchema.parse(bad)).toThrow()
  })
})

describe('disksPackageHints', () => {
  test('collects unique data fs and tank presence', () => {
    const disks = disksJsonSchema.parse({
      ...sample,
      data: {
        vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' },
        extra: { id: 'extra', mount: '/data', fs: 'ext4', size: '1G' },
        again: { id: 'again', mount: '/x', fs: 'xfs', size: '1G' },
      },
    })
    expect(disksPackageHints(disks)).toEqual({
      filesystems: ['ext4', 'xfs'],
      hasTanks: true,
    })
  })

  test('data-only → hasTanks false', () => {
    const disks = disksJsonSchema.parse({
      ...sample,
      tanks: {},
      encryptedTankIds: [],
      members: sample.members.filter((m) => m.kind !== 'tank'),
    })
    expect(disksPackageHints(disks)).toEqual({ filesystems: ['xfs'], hasTanks: false })
  })
})
