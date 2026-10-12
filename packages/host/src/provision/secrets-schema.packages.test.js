import {
  HG_HGRC_DEFAULT,
  HG_HGRC_PATH,
  HG_PIPX_DEFAULT,
  applyVcsFileDefaults,
  applyVcsPackageDefaults,
  normalizeFiles,
  normalizePackages,
  parseSecretsFile,
} from './secrets-schema.js'
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
    const p = applyVcsPackageDefaults(normalizePackages({ distro: ['nano'] }), 'hg')
    expect(p.pipx[0]).toEqual({
      package: HG_PIPX_DEFAULT.package,
      inject: [...HG_PIPX_DEFAULT.inject],
    })
    expect(p.distro).toEqual(['nano'])
  })

  test('hg keeps an explicit mercurial pin', () => {
    const p = applyVcsPackageDefaults(
      normalizePackages({
        pipx: [{ package: 'mercurial==6.0.0', inject: [] }],
      }),
      'hg',
    )
    expect(p.pipx).toEqual([{ package: 'mercurial==6.0.0', inject: [] }])
  })

  test('git does not add mercurial', () => {
    const p = applyVcsPackageDefaults(normalizePackages({}), 'git')
    expect(p.pipx).toEqual([])
  })
})

describe('applyVcsFileDefaults', () => {
  test('hg adds stock hgrc when missing', () => {
    const f = applyVcsFileDefaults(normalizeFiles([]), 'hg')
    expect(f).toHaveLength(1)
    expect(f[0].path).toBe(HG_HGRC_PATH)
    expect(f[0].owner).toBe(HG_HGRC_DEFAULT.owner)
    expect(f[0].permissions).toBe(HG_HGRC_DEFAULT.permissions)
    expect(f[0].content).toContain('evolve =')
  })

  test('hg keeps an explicit hgrc entry', () => {
    const f = applyVcsFileDefaults(
      normalizeFiles([
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
    expect(applyVcsFileDefaults(normalizeFiles([]), 'git')).toEqual([])
  })
})

describe('parseSecretsFile packages + repo.vcs', () => {
  test('repo.vcs hg does not inject at parse (seed profile applies defaults)', () => {
    const parsed = parseSecretsFile(
      {
        ...baseNet,
        repo: { vcs: 'hg' },
        packages: { distro: ['nano'], pipx: ['cowsay'] },
      },
      't',
    )
    expect(parsed.packages.distro).toEqual(['nano'])
    expect(parsed.packages.pipx).toEqual([{ package: 'cowsay', inject: [] }])
    expect(parsed.files).toEqual([])
  })
})
