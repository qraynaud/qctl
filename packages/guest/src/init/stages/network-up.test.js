import { packagesMapWithRequired } from '@qctl/shared'

import { createContext } from '../context.js'
import { StageError } from '../errors.js'
import networkUp from './network-up.js'
import { describe, expect, test } from 'bun:test'

const stubPackages = packagesMapWithRequired()

describe('network-up stage', () => {
  test('plan uses platform.networking.planEnsureUp when present', () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      platform: {
        id: 'fake',
        packages: stubPackages,
        installPackages: async () => {},
        networking: {
          planEnsureUp: () => ['bring up eth0'],
        },
      },
    })
    expect(networkUp.plan(ctx)).toEqual(['bring up eth0'])
  })

  test('run calls ensureUp', async () => {
    let called = false
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      platform: {
        id: 'fake',
        packages: stubPackages,
        installPackages: async () => {},
        networking: {
          ensureUp: async () => {
            called = true
          },
        },
      },
    })
    await networkUp.run(ctx)
    expect(called).toBe(true)
  })

  test('run fails when networking.ensureUp is missing', async () => {
    const ctx = createContext({
      env: { QCTL_ENV: 'dev' },
      log: () => {},
      platform: { id: 'fake', packages: stubPackages, installPackages: async () => {} },
    })
    await expect(networkUp.run(ctx)).rejects.toBeInstanceOf(StageError)
  })
})
