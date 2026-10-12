import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import zfsDrill from './zfs-drill.js'
import { describe, expect, test } from 'bun:test'

describe('zfs-drill stage', () => {
  test('exports name and plan', () => {
    expect(zfsDrill.name).toBe('zfs-drill')
    const ctx = createContext({ env: { QCTL_ENV: 'dev' }, log: () => {} })
    expect(zfsDrill.plan(ctx).length).toBeGreaterThan(0)
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
    })
    await expect(zfsDrill.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
