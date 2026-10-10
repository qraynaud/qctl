import { describe, expect, test } from 'bun:test'

import { QCTL_VERSION } from '@qctl/shared'

import {
  parsePlatformRef,
  platformIdFromGithubRepo,
  resolvePlatformVersion,
} from './platform-ref.js'

describe('platform-ref', () => {
  test('short name rocky defaults to host version', () => {
    const ref = parsePlatformRef('rocky')
    expect(ref).toMatchObject({
      id: 'rocky',
      githubRepo: 'qraynaud/qctl',
      versionPin: null,
      moduleFile: 'qctl-platform-rocky.mjs',
    })
    expect(resolvePlatformVersion(ref)).toBe(QCTL_VERSION)
  })

  test('short name with version pin', () => {
    const ref = parsePlatformRef('rocky@v0.2.0')
    expect(ref.versionPin).toBe('0.2.0')
    expect(resolvePlatformVersion(ref)).toBe('0.2.0')
  })

  test('github repo strips platform- prefix for id', () => {
    const ref = parsePlatformRef('github:qraynaud/platform-ubuntu')
    expect(ref).toMatchObject({
      id: 'ubuntu',
      githubRepo: 'qraynaud/platform-ubuntu',
      versionPin: null,
      moduleFile: 'qctl-platform-ubuntu.mjs',
    })
  })

  test('github repo with version', () => {
    const ref = parsePlatformRef('github:acme/platform-debian@1.2.3')
    expect(ref.versionPin).toBe('1.2.3')
    expect(ref.moduleFile).toBe('qctl-platform-debian.mjs')
  })

  test('unknown short name fails', () => {
    expect(() => parsePlatformRef('ubuntu')).toThrow(/unknown short name/)
  })

  test('empty / omitted defaults to rocky', () => {
    expect(parsePlatformRef(null).id).toBe('rocky')
    expect(parsePlatformRef('').id).toBe('rocky')
  })

  test('opts.version and QCTL_PLATFORM_VERSION override pin', () => {
    const ref = parsePlatformRef('rocky@0.1.0')
    expect(resolvePlatformVersion(ref, { version: 'v9.9.9' })).toBe('9.9.9')
    const prev = process.env.QCTL_PLATFORM_VERSION
    process.env.QCTL_PLATFORM_VERSION = '8.8.8'
    try {
      expect(resolvePlatformVersion(ref)).toBe('8.8.8')
    } finally {
      if (prev === undefined) delete process.env.QCTL_PLATFORM_VERSION
      else process.env.QCTL_PLATFORM_VERSION = prev
    }
  })

  test('platformIdFromGithubRepo', () => {
    expect(platformIdFromGithubRepo('qraynaud/platform-ubuntu')).toBe('ubuntu')
    expect(platformIdFromGithubRepo('acme/qctl-platform-foo')).toBe('foo')
  })
})
