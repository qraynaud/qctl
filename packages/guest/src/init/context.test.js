import { createContext, spawnCapture } from './context.js'
import { createTestContext, testOsConfig } from './context.test-helpers.js'
import { describe, expect, test } from 'bun:test'

describe('spawnCapture', () => {
  test('captures stdout/stderr and exit code', async () => {
    const r = await spawnCapture(['bash', '-c', 'echo out; echo err >&2; exit 3'], {})
    expect(r.code).toBe(3)
    expect(r.stdout.trim()).toBe('out')
    expect(r.stderr.trim()).toBe('err')
  })

  test('returns code 127 when the binary is missing', async () => {
    const r = await spawnCapture(['/no/such/qctl-binary-xyz'], {})
    expect(r.code).toBe(127)
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})

describe('createContext', () => {
  test('requires osConfig or seedConfig', () => {
    expect(() => createContext({ log: () => {} })).toThrow(/osConfig or seedConfig required/)
  })

  test('defaults profile and dryRun; applies overrides', () => {
    const log = () => {}
    const ctx = createContext({
      dryRun: true,
      profile: 'init-tank',
      osConfig: testOsConfig(),
      log,
    })
    expect(ctx.profile).toBe('init-tank')
    expect(ctx.dryRun).toBe(true)
    expect(ctx.log).toBe(log)
    expect(typeof ctx.isRoot).toBe('function')
    expect(typeof ctx.runBash).toBe('function')
    expect(typeof ctx.exec).toBe('function')
  })

  test('secrets, paths, flags, and osConfig are plain fields (no env bag)', () => {
    const ctx = createContext({
      osConfig: testOsConfig({ root: '/x' }),
      secrets: { A: '1', B: '  ' },
      paths: { initState: '/tmp/s.json' },
      flags: { skipZfsDrill: true },
      log: () => {},
    })
    expect(ctx.osConfig.root).toBe('/x')
    expect(ctx.secrets).toEqual({ A: '1' })
    expect(ctx.paths.initState).toBe('/tmp/s.json')
    expect(ctx.flags.skipZfsDrill).toBe(true)
    expect('env' in ctx).toBe(false)
  })

  test('runBash propagates secrets into the child env', async () => {
    const ctx = createContext({
      osConfig: testOsConfig(),
      secrets: { QCTL_TEST_SECRET: 'sek' },
      log: () => {},
    })
    const r = await ctx.exec(['bash', '-c', 'printf %s "$QCTL_TEST_SECRET"'])
    expect(r.stdout).toBe('sek')
  })
})

describe('createTestContext', () => {
  test('supplies default testOsConfig', () => {
    const ctx = createTestContext({ log: () => {} })
    expect(ctx.osConfig.root).toBe('/tank/rocky')
  })
})
