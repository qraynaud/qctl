import { module } from './proxmox.js'
import { describe, expect, test } from 'bun:test'

describe('proxmox module', () => {
  test('exposes thin ops + getStatus / targetCheck', () => {
    expect(String(module.id)).toBe('proxmox')
    for (const key of [
      'find',
      'create',
      'start',
      'stop',
      'destroy',
      'getStatus',
      'targetCheck',
      'powerState',
      'createFlagStore',
    ]) {
      expect(typeof module[/** @type {keyof typeof module} */ (key)]).toBe('function')
    }
  })
})
