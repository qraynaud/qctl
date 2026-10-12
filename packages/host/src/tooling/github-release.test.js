import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import { downloadGithubReleaseAsset } from './github-release.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('downloadGithubReleaseAsset', () => {
  test('returns null when required is false and download fails', async () => {
    const dir = makeTempDir()
    temps.push(dir)
    const dest = join(dir, 'missing-asset')
    spyOn(console, 'log').mockImplementation(() => {})
    const out = await downloadGithubReleaseAsset({
      githubRepo: 'qraynaud/qctl-no-such-repo-xyz',
      version: '0.0.0',
      name: 'nope.bin',
      dest,
      required: false,
    })
    expect(out).toBeNull()
    expect(existsSync(dest)).toBe(false)
  }, 30_000)
})
