import { expandCapabilities, packagesForCapabilities } from '@qctl/shared'

import { rockyPackagesMap } from './packages-map.js'
import { describe, expect, test } from 'bun:test'

describe('rockyPackagesMap', () => {
  test('maps core capabilities to distro packages', () => {
    expect(Object.isFrozen(rockyPackagesMap)).toBe(true)
    expect(rockyPackagesMap.curl?.distro).toEqual(['curl'])
    expect(rockyPackagesMap.zfs?.distro).toEqual(['zfs'])
    expect(rockyPackagesMap.xfs?.distro).toEqual(['xfsprogs'])
    expect(rockyPackagesMap.ext4?.distro).toEqual(['e2fsprogs'])
    expect(rockyPackagesMap.openssh?.distro).toEqual(['openssh-server'])
    expect(rockyPackagesMap.mercurial?.needs).toEqual(['pipx'])
    expect(rockyPackagesMap.cockpit?.distro).toContain('cockpit')
    expect(rockyPackagesMap['host-tools']?.distro).toContain('tar')
  })

  test('xfsprogs aliases to xfs', () => {
    expect(rockyPackagesMap.xfsprogs?.needs).toEqual(['xfs'])
    expect(expandCapabilities(rockyPackagesMap, ['xfsprogs'])).toEqual(['xfs', 'xfsprogs'])
    expect(packagesForCapabilities(rockyPackagesMap, ['xfsprogs']).distro).toEqual(['xfsprogs'])
  })
})
