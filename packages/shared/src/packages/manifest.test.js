import { mergePackages, packagesIsEmpty, packagesManifestSchema } from './manifest.js'
import { describe, expect, test } from 'bun:test'

describe('packages manifest', () => {
  test('prefault + defaults yield empty normalized manifest', () => {
    const empty = packagesManifestSchema.parse(undefined)
    expect(empty).toEqual({ distro: [], pipx: [], http: [] })
    expect(packagesIsEmpty(empty)).toBe(true)
    expect(packagesIsEmpty({ distro: ['curl'], pipx: [], http: [] })).toBe(false)
  })

  test('packagesManifestSchema.parse expands pipx strings and objects', () => {
    const n = packagesManifestSchema.parse({
      distro: ['curl'],
      pipx: ['foo', { package: 'bar', inject: ['baz'] }],
      http: [{ url: 'https://example.com/a.zip', bin: 'a' }],
    })
    expect(n.distro).toEqual(['curl'])
    expect(n.pipx).toEqual([
      { package: 'foo', inject: [] },
      { package: 'bar', inject: ['baz'] },
    ])
    expect(n.http[0]).toEqual({ url: 'https://example.com/a.zip', bin: 'a' })
  })

  test('packagesManifestSchema rejects whitespace in package names', () => {
    expect(packagesManifestSchema.safeParse({ distro: [' curl '] }).success).toBe(false)
    expect(packagesManifestSchema.safeParse({ distro: ['curl jq'] }).success).toBe(false)
    expect(packagesManifestSchema.safeParse({ pipx: ['hg==6.5'] }).success).toBe(true)
  })

  test('packagesManifestSchema omits absent http optional fields', () => {
    const n = packagesManifestSchema.parse({
      http: [{ url: 'https://example.com/x', dest: '/usr/local/bin/x' }],
    })
    expect(n.http[0]).toEqual({ url: 'https://example.com/x', dest: '/usr/local/bin/x' })
    expect(Object.hasOwn(n.http[0], 'bin')).toBe(false)
    expect(Object.hasOwn(n.http[0], 'test')).toBe(false)
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

  test('parse is idempotent on already-normalized output', () => {
    const n = packagesManifestSchema.parse({
      distro: ['curl'],
      pipx: ['hg'],
      http: [{ url: 'https://example.com/a.zip', bin: 'a' }],
    })
    expect(packagesManifestSchema.parse(n)).toEqual(n)
  })
})
