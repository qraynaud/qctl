import { createTestContext, testOsConfig } from '../../context.test-helpers.js'
import { detectQctlEnv } from './credentials.js'
import { describe, expect, test } from 'bun:test'

describe('detectQctlEnv', () => {
  test('uses osConfig.env when set', () => {
    expect(detectQctlEnv({ env: 'prod' })).toBe('prod')
    expect(detectQctlEnv({ env: '  dev  ' })).toBe('dev')
  })

  test('defaults to dev when unset', () => {
    expect(detectQctlEnv(undefined)).toBe('dev')
    expect(detectQctlEnv({})).toBe('dev')
    expect(detectQctlEnv({ env: '' })).toBe('dev')
    expect(detectQctlEnv({ env: '   ' })).toBe('dev')
  })
})

describe('createTestContext', () => {
  test('defaults osConfig + empty secrets/paths', () => {
    const ctx = createTestContext({ log: () => {} })
    expect(ctx.osConfig.env).toBe('dev')
    expect(ctx.osConfig.root).toBe('/tank/rocky')
    expect(ctx.secrets).toEqual({})
    expect(ctx.paths).toEqual({})
  })

  test('uses provided osConfig', () => {
    const ctx = createTestContext({
      osConfig: testOsConfig({ root: '/x', env: 'prod' }),
      log: () => {},
    })
    expect(ctx.osConfig.root).toBe('/x')
    expect(detectQctlEnv(ctx.osConfig)).toBe('prod')
  })
})
