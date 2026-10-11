import {
  distroPackagesForCapabilities,
  expandCapabilities,
  packagesForCapabilities,
} from '@qctl/shared'

import { CLOUD_IMAGE, platform } from './platform.js'
import { describe, expect, test } from 'bun:test'

describe('@qctl/platform-rocky module', () => {
  test('exports CLOUD_IMAGE pin', () => {
    expect(CLOUD_IMAGE.file).toMatch(/^Rocky-9-GenericCloud-Base-.*\.qcow2$/)
    expect(CLOUD_IMAGE.url).toContain(CLOUD_IMAGE.file)
    expect(CLOUD_IMAGE.sha256).toMatch(/^[a-f0-9]{64}$/)
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
