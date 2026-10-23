import { createDriver } from './workstation.js'
import { describe, expect, test } from 'bun:test'

describe('workstation createDriver', () => {
  test('returns workstation driver with lifecycle methods', () => {
    const driver = createDriver()
    expect(driver.id).toBe('workstation')
    for (const key of ['check', 'up', 'down', 'destroy', 'status', 'initTank', 'sshInfo']) {
      expect(typeof driver[/** @type {keyof typeof driver} */ (key)]).toBe('function')
    }
  })
})
