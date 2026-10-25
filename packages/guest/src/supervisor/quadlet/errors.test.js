import { QuadletError, die } from './errors.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet errors', () => {
  test('die throws QuadletError', () => {
    expect(() => die('boom')).toThrow(QuadletError)
    try {
      die('boom')
    } catch (e) {
      expect(e).toBeInstanceOf(QuadletError)
      expect(/** @type {QuadletError} */ (e).message).toBe('boom')
      expect(/** @type {QuadletError} */ (e).name).toBe('QuadletError')
    }
  })
})
