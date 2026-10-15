import {
  definePackagesMap,
  definePlatform,
  distroPackagesForCapabilities,
  expandCapabilities,
  packagesForCapabilities,
  packagesMapWithRequired,
  parsePlatformModule,
  requiredPlatformCapabilitySchema,
} from '../index.js'
import { describe, expect, test } from 'bun:test'

/** @import { PlatformPackagesMap } from './platform-types.js' */

/** @returns {PlatformPackagesMap} */
function sampleMap() {
  return packagesMapWithRequired({
    curl: { distro: ['curl'] },
    pipx: { distro: ['pipx'] },
    mercurial: {
      needs: ['pipx'],
      pipx: [{ package: 'mercurial==1', inject: ['hg-evolve'] }],
      distro: ['mercurial'],
    },
    zfs: { distro: ['zfs'] },
    xfs: { distro: ['xfsprogs'] },
    ext4: { distro: [] },
  })
}

describe('requiredPlatformCapabilitySchema', () => {
  test('accepts required names and rejects unknowns', () => {
    expect(requiredPlatformCapabilitySchema.parse('curl')).toBe('curl')
    expect(requiredPlatformCapabilitySchema.parse('zfs')).toBe('zfs')
    expect(() => requiredPlatformCapabilitySchema.parse('not-a-cap')).toThrow()
  })
})

describe('definePackagesMap', () => {
  test('freezes and requires fixed capability keys', () => {
    const m = packagesMapWithRequired({ zfs: { distro: ['zfs'] }, curl: { distro: ['curl'] } })
    expect(Object.isFrozen(m)).toBe(true)
    expect(m.zfs.distro).toEqual(['zfs'])
    expect(m.curl.distro).toEqual(['curl'])
  })

  test('rejects map missing a required capability', () => {
    expect(() =>
      definePackagesMap(/** @type {PlatformPackagesMap} */ ({ curl: { distro: ['curl'] } })),
    ).toThrow(/must include capability/)
  })
})

describe('definePlatform', () => {
  test('accepts open packages map + installPackages(string[])', () => {
    const p = definePlatform({
      id: 'test',
      packages: sampleMap(),
      installPackages: async () => {},
    })
    expect(p.id).toBe('test')
    expect(p.packages.curl).toBeTruthy()
    expect(p.packages.zfs).toBeTruthy()
    expect(Object.isFrozen(p)).toBe(true)
  })

  test('rejects packages missing a required capability', () => {
    expect(() =>
      definePlatform({
        id: 'x',
        packages: /** @type {PlatformPackagesMap} */ ({ curl: { distro: ['curl'] } }),
        installPackages: async () => {},
      }),
    ).toThrow(/must include capability/)
  })

  test('rejects needs pointing at unknown capability', () => {
    expect(() =>
      definePlatform({
        id: 'x',
        packages: packagesMapWithRequired({ a: { needs: ['missing'], distro: [] } }),
        installPackages: async () => {},
      }),
    ).toThrow(/unknown capability missing/)
  })

  test('when filesystems is set, requires defaultFs, osDisk, and FS package keys', () => {
    expect(() =>
      definePlatform({
        id: 'x',
        packages: sampleMap(),
        installPackages: async () => {},
        filesystems: ['xfs', 'ext4'],
      }),
    ).toThrow(/defaultFs/)

    expect(() =>
      definePlatform({
        id: 'x',
        packages: sampleMap(),
        installPackages: async () => {},
        filesystems: ['xfs', 'ext4'],
        defaultFs: 'xfs',
      }),
    ).toThrow(/osDisk/)

    expect(() =>
      definePlatform({
        id: 'x',
        packages: packagesMapWithRequired({ xfs: { distro: [] } }),
        installPackages: async () => {},
        filesystems: ['xfs', 'ext4'],
        defaultFs: 'xfs',
        osDisk: { size: '20G' },
      }),
    ).toThrow(/ext4/)

    expect(() =>
      definePlatform({
        id: 'x',
        packages: sampleMap(),
        installPackages: async () => {},
        filesystems: ['xfs'],
        defaultFs: 'ext4',
        osDisk: { id: 'os', size: '20G' },
      }),
    ).toThrow(/defaultFs/)

    const p = definePlatform({
      id: 'rocky-like',
      packages: sampleMap(),
      installPackages: async () => {},
      filesystems: ['xfs', 'ext4'],
      defaultFs: 'xfs',
      osDisk: { id: 'os', size: '20G' },
    })
    expect(p.filesystems).toEqual(['xfs', 'ext4'])
    expect(p.defaultFs).toBe('xfs')
    expect(p.osDisk).toEqual({ id: 'os', size: '20G' })
    expect(Object.isFrozen(p.filesystems)).toBe(true)
    expect(Object.isFrozen(p.osDisk)).toBe(true)
  })
})

describe('parsePlatformModule', () => {
  test('Zod-rejects packages missing a required capability', () => {
    expect(() =>
      parsePlatformModule({
        id: 'x',
        packages: /** @type {PlatformPackagesMap} */ ({ curl: { distro: ['curl'] } }),
        installPackages: async () => {},
      }),
    ).toThrow(/jq|expected object/)
  })

  test('Zod-rejects missing FS package keys when filesystems is set', () => {
    expect(() =>
      parsePlatformModule({
        id: 'x',
        packages: packagesMapWithRequired({ xfs: { distro: [] } }),
        installPackages: async () => {},
        filesystems: ['xfs', 'ext4'],
        defaultFs: 'xfs',
        osDisk: { size: '20G' },
      }),
    ).toThrow(/ext4|expected object/)
  })
})

describe('expandCapabilities / packagesForCapabilities', () => {
  test('needs edges expand in topo order', () => {
    expect(expandCapabilities(sampleMap(), ['mercurial'])).toEqual(['pipx', 'mercurial'])
  })

  test('collects distro + pipx from recipes', () => {
    const m = packagesForCapabilities(sampleMap(), ['mercurial'])
    expect(m.distro).toEqual(['pipx', 'mercurial'])
    expect(m.pipx).toEqual([{ package: 'mercurial==1', inject: ['hg-evolve'] }])
    expect(distroPackagesForCapabilities(sampleMap(), ['mercurial', 'curl'], ['nano'])).toEqual([
      'pipx',
      'mercurial',
      'curl',
      'nano',
    ])
  })
})
