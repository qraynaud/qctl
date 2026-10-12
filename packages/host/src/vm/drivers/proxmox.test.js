import { createDriver } from './proxmox.js'
import { describe, expect, test } from 'bun:test'

describe('proxmox createDriver', () => {
  test('returns proxmox driver with lifecycle methods', () => {
    const driver = createDriver()
    expect(driver.id).toBe('proxmox')
    for (const key of ['check', 'up', 'down', 'destroy', 'status', 'initTank', 'sshInfo']) {
      expect(typeof driver[/** @type {keyof typeof driver} */ (key)]).toBe('function')
    }
  })
})
