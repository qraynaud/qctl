import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import startServices from './start-services.js'
import { describe, expect, test } from 'bun:test'

describe('start-services stage', () => {
  test('plan includes unmask and dnat lines', () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      platform: {
        id: 'fake',
        packages: {},
        installPackages: async () => {},
        networking: { planApplyDnat: () => ['apply dnat'] },
      },
    })
    const plan = startServices.plan(ctx)
    expect(plan.some((l) => l.includes('unmask'))).toBe(true)
    expect(plan).toContain('apply dnat')
  })

  test('run requires root', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => false,
      platform: {
        id: 'fake',
        packages: {},
        installPackages: async () => {},
        networking: { applyDnat: async () => {} },
      },
    })
    await expect(startServices.run(ctx)).rejects.toBeInstanceOf(StageError)
  })

  test('run fails without applyDnat', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      isRoot: () => true,
      platform: { id: 'fake', packages: {}, installPackages: async () => {} },
    })
    await expect(startServices.run(ctx)).rejects.toThrow(/applyDnat/)
  })
})
