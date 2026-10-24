import { disksJsonPayload } from './disks-payload.js'
import { describe, expect, test } from 'bun:test'

describe('disksJsonPayload', () => {
  test('strips tank passphrases', () => {
    const resolved = {
      os: { id: 'os', size: '20G' },
      data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
      tanks: {
        tank: {
          id: 'tank',
          mount: '/tank',
          passphrase: 'secret',
          options: {
            pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
            dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
            acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
          },
          vdevs: {},
        },
      },
      members: [{ id: 'os', kind: /** @type {const} */ ('os'), size: '20G' }],
      encryptedTankIds: ['tank'],
    }
    const payload = disksJsonPayload(resolved)
    expect(payload.tanks.tank).not.toHaveProperty('passphrase')
    expect(payload.encryptedTankIds).toEqual(['tank'])
  })
})
