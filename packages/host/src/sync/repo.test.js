import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $ } from 'zx'

import {
  SYNC_TAR_EXCLUDES,
  buildRepoArchive,
  listArchivePaths,
  remoteDeleteScript,
} from './repo.js'
import { resolveGuestToolingForSync } from './tooling.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []
afterEach(async () => {
  while (temps.length) {
    const d = temps.pop()
    if (d) await $`rm -rf ${d}`.nothrow()
  }
})

describe('sync repo archive', () => {
  test('excludes host secrets and VCS dirs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qctl-sync-src-'))
    temps.push(root)
    writeFileSync(join(root, 'README.md'), 'hi\n')
    writeFileSync(join(root, '.env.host'), 'SECRET=1\n')
    mkdirSync(join(root, '.hg'))
    writeFileSync(join(root, '.hg', 'requires'), 'x\n')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'x'), 'y\n')

    const out = mkdtempSync(join(tmpdir(), 'qctl-sync-out-'))
    temps.push(out)
    const archive = join(out, 'a.tgz')
    await buildRepoArchive(root, archive)

    const extract = join(out, 'x')
    mkdirSync(extract)
    await $`tar -C ${extract} -xzf ${archive}`
    expect(readFileSync(join(extract, 'README.md'), 'utf8')).toBe('hi\n')
    expect(() => readFileSync(join(extract, '.env.host'))).toThrow()
    expect(() => readFileSync(join(extract, '.hg', 'requires'))).toThrow()
    expect(() => readFileSync(join(extract, 'node_modules', 'x'))).toThrow()
    expect(SYNC_TAR_EXCLUDES).toContain('.env.host')
    expect(SYNC_TAR_EXCLUDES).toContain('.env') // upload-only; deleted on guest if present

    const paths = await listArchivePaths(archive)
    expect(paths).toContain('./README.md')
    expect(paths.some((p) => p.includes('.env.host'))).toBe(false)
  })

  test('remoteDeleteScript prunes dirs and protects host-only file basenames', () => {
    const script = remoteDeleteScript()
    expect(script).toContain("-name '.hg'")
    expect(script).toContain("-name 'node_modules'")
    expect(script).toContain("! -name '.env.host'")
    expect(script).not.toContain("! -name '.env'")
    expect(script).toContain('grep -Fxq')
  })
})

describe('resolveGuestToolingForSync', () => {
  test('finds binaries under QCTL_GUEST_DIST', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'qctl-dist-'))
    temps.push(dist)
    writeFileSync(join(dist, 'qctl-guest'), '#!/bin/sh\n')
    writeFileSync(join(dist, 'qctl-platform-rocky.mjs'), 'export default {}\n')
    const prev = process.env.QCTL_GUEST_DIST
    process.env.QCTL_GUEST_DIST = dist
    try {
      const t = await resolveGuestToolingForSync()
      expect(t.sourceLabel).toBe(dist)
      expect(t.files.map((f) => f.installAs)).toEqual([
        '/usr/local/bin/qctl',
        '/usr/local/lib/qctl/qctl-platform-rocky.mjs',
      ])
    } finally {
      if (prev === undefined) delete process.env.QCTL_GUEST_DIST
      else process.env.QCTL_GUEST_DIST = prev
    }
  })
})
