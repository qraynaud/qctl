import { createTestContext } from '../context.test-helpers.js'
import { StageError } from '../errors.js'
import hostBaseline from './host-baseline.js'
import { describe, expect, test } from 'bun:test'

describe('host-baseline stage', () => {
  test('exports name and plan', () => {
    expect(hostBaseline.name).toBe('host-baseline')
    const ctx = createTestContext({ log: () => {} })
    expect(hostBaseline.plan(ctx).some((l) => l.includes('linger'))).toBe(true)
  })

  test('run requires root', async () => {
    const ctx = createTestContext({
      log: () => {},
      isRoot: () => false,
    })
    await expect(hostBaseline.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
