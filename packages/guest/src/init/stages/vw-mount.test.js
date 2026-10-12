import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import vwMount from './vw-mount.js'
import { describe, expect, test } from 'bun:test'

describe('vw-mount stage', () => {
  test('exports name and plan', () => {
    expect(vwMount.name).toBe('vw-mount')
    const ctx = createContext({ env: { QCTL_ENV: 'dev' }, log: () => {} })
    expect(vwMount.plan(ctx).length).toBeGreaterThan(0)
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(vwMount.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
