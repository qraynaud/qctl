import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { loadDisksJson, loadDisksPackageHints } from './disks-json.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

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

describe('loadDisksJson / loadDisksPackageHints', () => {
  test('missing file → null', async () => {
    expect(await loadDisksJson({ ROCKY_DISKS_JSON: '/tmp/qctl-missing-disks.json' })).toBe(null)
    expect(await loadDisksPackageHints({ ROCKY_DISKS_JSON: '/tmp/qctl-missing-disks.json' })).toBe(
      null,
    )
  })

  test('parses via shared disksJsonSchema and returns package hints', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'disks.json')
    writeFileSync(path, JSON.stringify(sample))
    const disks = await loadDisksJson({ ROCKY_DISKS_JSON: path })
    expect(disks?.os.id).toBe('os')
    expect(await loadDisksPackageHints({ ROCKY_DISKS_JSON: path })).toEqual({
      filesystems: ['xfs'],
      hasTanks: true,
    })
  })

  test('rejects invalid disks.json', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const path = join(dir, 'disks.json')
    writeFileSync(path, JSON.stringify({ os: { id: 'os' } }))
    await expect(loadDisksJson({ ROCKY_DISKS_JSON: path })).rejects.toThrow(/failed to read/)
  })
})
