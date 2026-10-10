import {
  definePlatform,
  distroPackagesForCapabilities,
  expandCapabilities,
  packagesForCapabilities,
} from '../index.js'
import { describe, expect, test } from 'bun:test'

/** @import { PlatformPackagesMap } from './module.js' */

/** @returns {PlatformPackagesMap} */
function sampleMap() {
  return {
    curl: { distro: ['curl'] },
    pipx: { distro: ['pipx'] },
    mercurial: {
      needs: ['pipx'],
      pipx: [{ package: 'mercurial==1', inject: ['hg-evolve'] }],
    },
    zfs: { distro: ['zfs'] },
  }
}

describe('definePlatform', () => {
  test('accepts open packages map + installPackages(string[])', () => {
    const p = definePlatform({
      id: 'test',
      packages: sampleMap(),
      installPackages: async () => {},
    })
    expect(p.id).toBe('test')
    expect(Object.keys(p.packages).sort()).toEqual(['curl', 'mercurial', 'pipx', 'zfs'])
  })

  test('rejects needs pointing at unknown capability', () => {
    expect(() =>
      definePlatform({
        id: 'x',
        packages: { a: { needs: ['missing'], distro: [] } },
        installPackages: async () => {},
      }),
    ).toThrow(/unknown capability missing/)
  })
})

describe('expandCapabilities / packagesForCapabilities', () => {
  test('needs edges expand in topo order', () => {
    expect(expandCapabilities(sampleMap(), ['mercurial'])).toEqual(['pipx', 'mercurial'])
  })

  test('collects distro + pipx from recipes', () => {
    const m = packagesForCapabilities(sampleMap(), ['mercurial'])
    expect(m.distro).toEqual(['pipx'])
    expect(m.pipx).toEqual([{ package: 'mercurial==1', inject: ['hg-evolve'] }])
    expect(distroPackagesForCapabilities(sampleMap(), ['mercurial', 'curl'], ['nano'])).toEqual([
      'pipx',
      'curl',
      'nano',
    ])
  })
})
