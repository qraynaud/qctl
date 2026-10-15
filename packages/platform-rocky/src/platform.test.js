import {
  distroPackagesForCapabilities,
  expandCapabilities,
  packagesForCapabilities,
} from '@qctl/shared'

import { CLOUD_IMAGE, DEFAULT_FS, FILESYSTEMS, OS_DISK, platform } from './platform.js'
import { describe, expect, test } from 'bun:test'

describe('@qctl/platform-rocky module', () => {
  test('exports CLOUD_IMAGE pin', () => {
    expect(CLOUD_IMAGE.file).toMatch(/^Rocky-9-GenericCloud-Base-.*\.qcow2$/)
    expect(CLOUD_IMAGE.url).toContain(CLOUD_IMAGE.file)
    expect(CLOUD_IMAGE.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  test('exports filesystems, defaultFs, and osDisk defaults', () => {
    expect(FILESYSTEMS).toEqual(['xfs', 'ext4'])
    expect(DEFAULT_FS).toBe('xfs')
    expect(OS_DISK).toEqual({ id: 'os', size: '20G' })
    expect(platform.filesystems).toEqual(['xfs', 'ext4'])
    expect(platform.defaultFs).toBe('xfs')
    expect(platform.osDisk).toEqual({ id: 'os', size: '20G' })
    expect(platform.packages.xfs?.distro).toEqual(['xfsprogs'])
    expect(platform.packages.ext4?.distro).toEqual(['e2fsprogs'])
  })

  test('exports packages map + installPackages + networking', () => {
    expect(platform.id).toBe('rocky')
    expect(typeof platform.installPackages).toBe('function')
    expect(typeof platform.networking?.ensureUp).toBe('function')
    expect(typeof platform.networking?.applyDnat).toBe('function')
    expect(platform.packages.curl?.distro).toEqual(['curl'])
    expect(platform.packages.pipx?.distro).toEqual(['pipx'])
    expect(platform.packages.mercurial?.needs).toEqual(['pipx'])
    const hgPipx = platform.packages.mercurial?.pipx?.[0]
    const hgPkg = typeof hgPipx === 'string' ? hgPipx : hgPipx?.package
    expect(hgPkg).toMatch(/^mercurial==/)
  })

  test('mercurial resolves to distro pipx + pipx toolchain', () => {
    expect(expandCapabilities(platform.packages, ['mercurial'])).toEqual(['pipx', 'mercurial'])
    expect(distroPackagesForCapabilities(platform.packages, ['mercurial'])).toEqual(['pipx'])
    const m = packagesForCapabilities(platform.packages, ['mercurial'])
    expect(m.distro).toEqual(['pipx'])
    expect(m.pipx.some((p) => p.package.startsWith('mercurial'))).toBe(true)
  })
})
