import { createContext, envWithQctlEnv, spawnCapture } from './context.js'
import { describe, expect, test } from 'bun:test'

describe('envWithQctlEnv', () => {
  test('preserves an explicit QCTL_ENV', () => {
    const env = envWithQctlEnv({ QCTL_ENV: 'prod', X: '1' })
    expect(env.QCTL_ENV).toBe('prod')
    expect(env.X).toBe('1')
  })
})

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
  test('defaults profile and dryRun; applies overrides', () => {
    const log = () => {}
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      dryRun: true,
      profile: 'init-tank',
      log,
    })
    expect(ctx.profile).toBe('init-tank')
    expect(ctx.dryRun).toBe(true)
    expect(ctx.log).toBe(log)
    expect(typeof ctx.isRoot).toBe('function')
    expect(typeof ctx.runBash).toBe('function')
    expect(typeof ctx.exec).toBe('function')
  })
})
