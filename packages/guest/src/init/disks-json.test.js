import { disksJsonSchema } from '@qctl/shared'

import { disksPackageHintsFrom, resolveDisks } from './disks-json.js'
import { describe, expect, test } from 'bun:test'

/** @import { DisksJson } from '@qctl/shared' */

/** @type {DisksJson} */
const sample = disksJsonSchema.parse({
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
})

describe('resolveDisks / disksPackageHintsFrom', () => {
  test('undefined → null', () => {
    expect(resolveDisks(undefined)).toBe(null)
    expect(disksPackageHintsFrom(undefined)).toBe(null)
  })

  test('parses via shared disksJsonSchema and returns package hints', () => {
    expect(resolveDisks(sample)?.os.id).toBe('os')
    expect(disksPackageHintsFrom(sample)).toEqual({
      filesystems: ['xfs'],
      hasTanks: true,
    })
  })

  test('rejects invalid disks', () => {
    expect(() => resolveDisks(/** @type {any} */ ({ os: { id: 'os' } }))).toThrow()
  })
})
