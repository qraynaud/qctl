import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import tankCreate from './tank-create.js'
import { describe, expect, test } from 'bun:test'

describe('tank-create stage', () => {
  test('exports name and plan', () => {
    expect(tankCreate.name).toBe('tank-create')
    const ctx = createContext({ env: { QCTL_ENV: 'dev' }, log: () => {} })
    expect(tankCreate.plan(ctx).length).toBeGreaterThan(0)
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(tankCreate.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
