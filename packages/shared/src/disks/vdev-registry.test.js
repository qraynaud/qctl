import { vdevGeometryArgv, vdevRoleArgv, vdevTypeGeometry, zfsAcltype } from './vdev-registry.js'
import { buildZpoolCreateArgv } from './zpool-create.js'
import { describe, expect, test } from 'bun:test'

describe('vdev registry', () => {
  test('type → geometry keyword', () => {
    expect(vdevTypeGeometry('single')).toBeNull()
    expect(vdevTypeGeometry('mirror')).toBe('mirror')
    expect(vdevTypeGeometry('raidz2')).toBe('raidz2')
  })

  test('role argv includes special class', () => {
    expect(vdevGeometryArgv('single', ['/dev/a'])).toEqual(['/dev/a'])
    expect(vdevRoleArgv('data', 'raidz2', ['/dev/a', '/dev/b', '/dev/c'])).toEqual([
      'raidz2',
      '/dev/a',
      '/dev/b',
      '/dev/c',
    ])
    expect(vdevRoleArgv('special', 'mirror', ['/dev/s0', '/dev/s1'])).toEqual([
      'special',
      'mirror',
      '/dev/s0',
      '/dev/s1',
    ])
  })

  test('posix acltype → posixacl', () => {
    expect(zfsAcltype('posix')).toBe('posixacl')
    expect(zfsAcltype('nfsv4')).toBe('nfsv4')
  })
})

describe('buildZpoolCreateArgv', () => {
  const options = {
    pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
    dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
    acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
  }

  test('raidz2 data + special mirror + encryption', () => {
    const argv = buildZpoolCreateArgv({
      pool: 'tank',
      mount: '/tank',
      options,
      encryption: { keylocation: 'file:///etc/credstore/rocky/tank_passphrase_tank' },
      vdevs: [
        {
          role: 'data',
          type: 'raidz2',
          devices: ['/dev/d0', '/dev/d1', '/dev/d2', '/dev/d3', '/dev/d4'],
        },
        { role: 'special', type: 'mirror', devices: ['/dev/s0', '/dev/s1'] },
      ],
    })
    expect(argv.slice(0, 3)).toEqual(['zpool', 'create', '-f'])
    expect(argv).toContain('-o')
    expect(argv).toContain('ashift=12')
    expect(argv).toContain('encryption=aes-256-gcm')
    expect(argv).toContain('keylocation=file:///etc/credstore/rocky/tank_passphrase_tank')
    expect(argv).toContain('acltype=posixacl')
    expect(argv).toContain('mountpoint=/tank')
    const poolIdx = argv.indexOf('tank')
    expect(argv.slice(poolIdx)).toEqual([
      'tank',
      'raidz2',
      '/dev/d0',
      '/dev/d1',
      '/dev/d2',
      '/dev/d3',
      '/dev/d4',
      'special',
      'mirror',
      '/dev/s0',
      '/dev/s1',
    ])
  })

  test('unencrypted single data vdev', () => {
    const argv = buildZpoolCreateArgv({
      pool: 'cold',
      mount: '/cold',
      options,
      vdevs: [{ role: 'data', type: 'single', devices: ['/dev/x'] }],
    })
    expect(argv).not.toContain('encryption=aes-256-gcm')
    expect(argv.slice(argv.indexOf('cold'))).toEqual(['cold', '/dev/x'])
  })
})
