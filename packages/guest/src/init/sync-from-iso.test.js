import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeTempDir } from '@qctl/shared/test-helpers'

import {
  SELF_UPDATE_DONE_ENV,
  findIsoPlatformModule,
  reexecAfterSelfUpdate,
  sha256File,
  syncToolingFromIso,
} from './sync-from-iso.js'
import { afterEach, describe, expect, test } from 'bun:test'

/** @type {string[]} */
const temps = []

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) removeTempDir(dir)
  }
})

/**
 * @param {string} guestDir
 * @param {{ binary?: string, platform?: string, varlock?: string }} [files]
 */
function stageIsoGuest(guestDir, files = {}) {
  mkdirSync(guestDir, { recursive: true })
  writeFileSync(join(guestDir, 'qctl-guest'), files.binary ?? 'guest-bin-v1\n', { mode: 0o755 })
  writeFileSync(
    join(guestDir, 'qctl-platform-rocky.mjs'),
    files.platform ?? 'export const platform = { id: "rocky" }\n',
    { mode: 0o644 },
  )
  if (files.varlock != null) {
    writeFileSync(join(guestDir, 'varlock-local-encrypt'), files.varlock, { mode: 0o755 })
  }
}

describe('findIsoPlatformModule', () => {
  test('requires exactly one module', () => {
    const dir = makeTempDir()
    temps.push(dir)
    mkdirSync(dir, { recursive: true })
    expect(() => findIsoPlatformModule(dir)).toThrow(/exactly one/)
    writeFileSync(join(dir, 'qctl-platform-a.mjs'), 'a\n')
    writeFileSync(join(dir, 'qctl-platform-b.mjs'), 'b\n')
    expect(() => findIsoPlatformModule(dir)).toThrow(/exactly one/)
  })
})

describe('syncToolingFromIso', () => {
  test('always installs platform + refreshes QCTL_PLATFORM_MODULE; reexec on binary change', () => {
    const base = makeTempDir()
    temps.push(base)
    const guestDir = join(base, 'iso-guest')
    const binDir = join(base, 'bin')
    const libDir = join(base, 'lib')
    const envPath = join(base, '90-qctl-platform.conf')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(libDir, { recursive: true })
    stageIsoGuest(guestDir, { binary: 'new-bin\n', varlock: 'vl\n' })
    writeFileSync(join(binDir, 'qctl'), 'old-bin\n')
    writeFileSync(join(libDir, 'qctl-platform-stale.mjs'), 'stale\n')

    /** @type {Record<string, string | undefined>} */
    const env = {}
    /** @type {string[]} */
    const logs = []
    const result = syncToolingFromIso(
      { guestDir },
      {
        env,
        log: (l) => logs.push(l),
        paths: {
          binDir,
          libDir,
          platformEnvPath: envPath,
          qctlBin: join(binDir, 'qctl'),
          varlockBin: join(binDir, 'varlock-local-encrypt'),
        },
      },
    )

    expect(result.disposition).toBe('reexec')
    expect(result.tooling.binaryUpdated).toBe(true)
    expect(result.tooling.varlockUpdated).toBe(true)
    expect(readFileSync(join(binDir, 'qctl'), 'utf8')).toBe('new-bin\n')
    expect(readFileSync(join(binDir, 'varlock-local-encrypt'), 'utf8')).toBe('vl\n')
    expect(existsSync(join(libDir, 'qctl-platform-rocky.mjs'))).toBe(true)
    expect(existsSync(join(libDir, 'qctl-platform-stale.mjs'))).toBe(false)
    expect(env.QCTL_PLATFORM_MODULE).toBe(join(libDir, 'qctl-platform-rocky.mjs'))
    expect(readFileSync(envPath, 'utf8')).toBe(
      `QCTL_PLATFORM_MODULE=${join(libDir, 'qctl-platform-rocky.mjs')}\n`,
    )
    expect(logs.some((l) => l.includes('platform'))).toBe(true)
  })

  test('platform refreshes even when binary hash matches', () => {
    const base = makeTempDir()
    temps.push(base)
    const guestDir = join(base, 'iso-guest')
    const binDir = join(base, 'bin')
    const libDir = join(base, 'lib')
    const envPath = join(base, 'env.conf')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(libDir, { recursive: true })
    const binary = 'same-bin\n'
    stageIsoGuest(guestDir, { binary, platform: 'export const platform = { id: "v2" }\n' })
    writeFileSync(join(binDir, 'qctl'), binary)
    writeFileSync(join(libDir, 'qctl-platform-rocky.mjs'), 'old\n')

    /** @type {Record<string, string | undefined>} */
    const env = { QCTL_PLATFORM_MODULE: join(libDir, 'qctl-platform-rocky.mjs') }
    const result = syncToolingFromIso(
      { guestDir },
      {
        env,
        paths: {
          binDir,
          libDir,
          platformEnvPath: envPath,
          qctlBin: join(binDir, 'qctl'),
          varlockBin: join(binDir, 'varlock-local-encrypt'),
        },
      },
    )
    expect(result.disposition).toBe('continue')
    expect(result.tooling.binaryUpdated).toBe(false)
    expect(readFileSync(join(libDir, 'qctl-platform-rocky.mjs'), 'utf8')).toContain('v2')
  })

  test(`${SELF_UPDATE_DONE_ENV}=1 continues after binary replace`, () => {
    const base = makeTempDir()
    temps.push(base)
    const guestDir = join(base, 'iso-guest')
    const binDir = join(base, 'bin')
    const libDir = join(base, 'lib')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(libDir, { recursive: true })
    stageIsoGuest(guestDir, { binary: 'v2\n' })
    writeFileSync(join(binDir, 'qctl'), 'v1\n')

    /** @type {Record<string, string | undefined>} */
    const env = { [SELF_UPDATE_DONE_ENV]: '1' }
    const result = syncToolingFromIso(
      { guestDir },
      {
        env,
        paths: {
          binDir,
          libDir,
          platformEnvPath: join(base, 'env.conf'),
          qctlBin: join(binDir, 'qctl'),
          varlockBin: join(binDir, 'varlock-local-encrypt'),
        },
      },
    )
    expect(result.tooling.binaryUpdated).toBe(true)
    expect(result.disposition).toBe('continue')
  })
})

describe('reexecAfterSelfUpdate', () => {
  test('sets guard env and spawns execPath + argv tail', async () => {
    /** @type {string[] | undefined} */
    let gotArgv
    /** @type {Record<string, string | undefined> | undefined} */
    let gotEnv
    const code = await reexecAfterSelfUpdate({
      env: { FOO: '1' },
      execPath: '/usr/local/bin/qctl',
      argv: ['/usr/local/bin/qctl', '_internal_init', '--profile', 'default'],
      spawn: async (argv, env) => {
        gotArgv = argv
        gotEnv = env
        return 42
      },
    })
    expect(code).toBe(42)
    expect(gotArgv).toEqual(['/usr/local/bin/qctl', '_internal_init', '--profile', 'default'])
    expect(gotEnv?.[SELF_UPDATE_DONE_ENV]).toBe('1')
    expect(gotEnv?.FOO).toBe('1')
  })
})

describe('sha256File', () => {
  test('hashes file bytes', () => {
    const dir = makeTempDir()
    temps.push(dir)
    const p = join(dir, 'f')
    writeFileSync(p, 'abc')
    const abc = createHash('sha256').update('abc').digest('hex')
    expect(sha256File(p)).toBe(abc)
    writeFileSync(p, 'abd')
    expect(sha256File(p)).not.toBe(abc)
  })
})
