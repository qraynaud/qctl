import { createDriver } from './local.js'
import { describe, expect, test } from 'bun:test'

describe('local createDriver', () => {
  test('returns local driver with lifecycle methods', () => {
    const driver = createDriver()
    expect(driver.id).toBe('local')
    for (const key of ['check', 'up', 'down', 'destroy', 'status', 'initTank', 'sshInfo']) {
      expect(typeof driver[/** @type {keyof typeof driver} */ (key)]).toBe('function')
    }
  })
})
