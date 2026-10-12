import { rockyPackagesMap } from './packages-map.js'
import { describe, expect, test } from 'bun:test'

describe('rockyPackagesMap', () => {
  test('maps core capabilities to distro packages', () => {
    expect(rockyPackagesMap.curl?.distro).toEqual(['curl'])
    expect(rockyPackagesMap.zfs?.distro).toEqual(['zfs'])
    expect(rockyPackagesMap.openssh?.distro).toEqual(['openssh-server'])
    expect(rockyPackagesMap.mercurial?.needs).toEqual(['pipx'])
    expect(rockyPackagesMap.cockpit?.distro).toContain('cockpit')
  })
})
