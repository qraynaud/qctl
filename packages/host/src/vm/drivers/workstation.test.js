import { module } from './workstation.js'
import { describe, expect, test } from 'bun:test'

describe('workstation module', () => {
  test('exposes thin ops + getStatus / targetCheck', () => {
    expect(String(module.id)).toBe('workstation')
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
