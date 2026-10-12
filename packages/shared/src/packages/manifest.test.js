import {
  emptyPackages,
  mergePackages,
  normalizePackages,
  packagesIsEmpty,
  packagesManifestSchema,
} from './manifest.js'
import { describe, expect, test } from 'bun:test'

describe('packages manifest', () => {
  test('emptyPackages and packagesIsEmpty', () => {
    const empty = emptyPackages()
    expect(packagesIsEmpty(empty)).toBe(true)
    expect(packagesIsEmpty({ distro: ['curl'], pipx: [], http: [] })).toBe(false)
  })

  test('normalizePackages expands pipx strings and objects', () => {
    const n = normalizePackages({
      distro: [' curl ', ''],
      pipx: ['foo', { package: 'bar', inject: ['baz'] }],
      http: [{ url: 'https://example.com/a.zip', bin: 'a' }],
    })
    expect(n.distro).toEqual(['curl'])
    expect(n.pipx).toEqual([
      { package: 'foo', inject: [] },
      { package: 'bar', inject: ['baz'] },
    ])
    expect(n.http[0]).toMatchObject({ url: 'https://example.com/a.zip', bin: 'a' })
  })

  test('mergePackages appends distro and overrides pipx by name', () => {
    const m = mergePackages(
      { distro: ['curl'], pipx: [{ package: 'hg==1', inject: [] }], http: [] },
      { distro: ['curl', 'jq'], pipx: [{ package: 'hg==2', inject: ['x'] }], http: [] },
    )
    expect(m.distro).toEqual(['curl', 'jq'])
    expect(m.pipx).toEqual([{ package: 'hg==2', inject: ['x'] }])
  })

  test('packagesManifestSchema rejects http without bin/dest', () => {
    const r = packagesManifestSchema.safeParse({
      http: [{ url: 'https://example.com/x' }],
    })
    expect(r.success).toBe(false)
  })
})
