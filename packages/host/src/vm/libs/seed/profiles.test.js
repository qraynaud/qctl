import { HG_HGRC_PATH, HG_PIPX_DEFAULT } from '../../../provision/secrets-schema/index.js'
import { filesForSeedProfile, packagesForSeedProfile } from './profiles.js'
import { describe, expect, test } from 'bun:test'

describe('packagesForSeedProfile', () => {
  test('keeps user pipx; auto mercurial only on appliance+hg', () => {
    const pkgs = {
      distro: ['nano'],
      pipx: [{ package: 'cowsay', inject: [] }],
      http: [{ url: 'https://example.com/bw.zip', bin: 'bw', dest: null, test: null }],
    }
    expect(packagesForSeedProfile('init-tank', pkgs, 'hg')).toEqual(pkgs)
    const appliance = packagesForSeedProfile('appliance', pkgs, 'hg')
    expect(appliance.pipx[0]).toEqual({
      package: HG_PIPX_DEFAULT.package,
      inject: [...HG_PIPX_DEFAULT.inject],
    })
    expect(appliance.pipx[1]).toEqual({ package: 'cowsay', inject: [] })
    expect(packagesForSeedProfile('appliance', pkgs, 'git').pipx).toEqual(pkgs.pipx)
  })
})

describe('filesForSeedProfile', () => {
  test('adds hgrc only on appliance+hg', () => {
    expect(filesForSeedProfile('init-tank', [], 'hg')).toEqual([])
    const appliance = filesForSeedProfile('appliance', [], 'hg')
    expect(appliance).toHaveLength(1)
    expect(appliance[0].path).toBe(HG_HGRC_PATH)
  })
})
