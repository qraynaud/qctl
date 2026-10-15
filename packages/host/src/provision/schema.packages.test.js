import { HG_HGRC_DEFAULT, HG_HGRC_PATH, applyVcsFileDefaults, filesSchema } from './schema/files.js'
import { HG_PIPX_DEFAULT, applyVcsPackageDefaults, packagesSchema } from './schema/packages.js'
import { provisionSchema } from './schema/parse.js'
import { describe, expect, test } from 'bun:test'

const baseNet = {
  networking: {
    ports: { ssh: { port: 22 } },
    uplinks: { eth0: { dhcp4: true } },
    vlans: {},
  },
}

describe('applyVcsPackageDefaults', () => {
  test('hg adds mercurial pipx when missing', () => {
    const p = applyVcsPackageDefaults(packagesSchema.parse({ distro: ['nano'] }), 'hg')
    expect(p.pipx[0]).toEqual({
      package: HG_PIPX_DEFAULT.package,
      inject: [...HG_PIPX_DEFAULT.inject],
    })
    expect(p.distro).toEqual(['nano'])
  })

  test('hg keeps an explicit mercurial pin', () => {
    const p = applyVcsPackageDefaults(
      packagesSchema.parse({
        pipx: [{ package: 'mercurial==6.0.0', inject: [] }],
      }),
      'hg',
    )
    expect(p.pipx).toEqual([{ package: 'mercurial==6.0.0', inject: [] }])
  })

  test('git does not add mercurial', () => {
    const p = applyVcsPackageDefaults(packagesSchema.parse({}), 'git')
    expect(p.pipx).toEqual([])
  })
})

describe('applyVcsFileDefaults', () => {
  test('hg adds stock hgrc when missing', () => {
    const f = applyVcsFileDefaults(filesSchema.parse([]), 'hg')
    expect(f).toHaveLength(1)
    expect(f[0].path).toBe(HG_HGRC_PATH)
    expect(f[0].owner).toBe(HG_HGRC_DEFAULT.owner)
    expect(f[0].permissions).toBe(HG_HGRC_DEFAULT.permissions)
    expect(f[0].content).toContain('evolve =')
  })

  test('hg keeps an explicit hgrc entry', () => {
    const f = applyVcsFileDefaults(
      filesSchema.parse([
        {
          path: HG_HGRC_PATH,
          content: '# custom\n',
          mode: '0600',
        },
      ]),
      'hg',
    )
    expect(f).toHaveLength(1)
    expect(f[0].content).toBe('# custom\n')
    expect(f[0].permissions).toBe('0600')
  })

  test('git does not add hgrc', () => {
    expect(applyVcsFileDefaults(filesSchema.parse([]), 'git')).toEqual([])
  })
})

describe('provisionSchema packages + repo.vcs', () => {
  test('repo.vcs hg does not inject at parse (seed profile applies defaults)', () => {
    const data = provisionSchema.parse({
      ...baseNet,
      repo: { vcs: 'hg' },
      packages: { distro: ['nano'], pipx: ['cowsay'] },
    })
    expect(data.packages.distro).toEqual(['nano'])
    expect(data.packages.pipx).toEqual([{ package: 'cowsay', inject: [] }])
    expect(data.files).toEqual([])
  })
})
