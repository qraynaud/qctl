import { createContext, envWithQctlEnv } from '../../context.js'
import { detectQctlEnv } from './credentials.js'
import { describe, expect, test } from 'bun:test'

describe('detectQctlEnv', () => {
  test('uses QCTL_ENV when set', () => {
    expect(detectQctlEnv({ QCTL_ENV: 'prod' })).toBe('prod')
    expect(detectQctlEnv({ QCTL_ENV: '  dev  ' })).toBe('dev')
  })

  test('defaults to dev when unset', () => {
    expect(detectQctlEnv({})).toBe('dev')
    expect(detectQctlEnv({ QCTL_ENV: '' })).toBe('dev')
    expect(detectQctlEnv({ QCTL_ENV: '   ' })).toBe('dev')
  })
})

describe('envWithQctlEnv / createContext', () => {
  test('fills QCTL_ENV when missing', () => {
    const env = envWithQctlEnv({ FOO: '1' })
    expect(env.QCTL_ENV).toBe('dev')
    expect(env.FOO).toBe('1')
  })

  test('createContext normalizes QCTL_ENV on ctx.env', () => {
    const ctx = createContext({
      env: { ROCKY_REPO_DIR: '/tank/rocky' },
      log: () => {},
    })
    expect(ctx.env.QCTL_ENV).toBe('dev')
    expect(ctx.env.ROCKY_REPO_DIR).toBe('/tank/rocky')
  })
})
