import { LocalExit, argvApps, die } from './util.js'
import { describe, expect, test } from 'bun:test'

describe('local util', () => {
  test('argvApps normalizes string, array, and empty', () => {
    expect(argvApps({ apps: 'web' })).toEqual(['web'])
    expect(argvApps({ apps: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(argvApps({ app: 'legacy' })).toEqual(['legacy'])
    expect(argvApps({})).toEqual([])
  })

  test('die throws LocalExit', () => {
    expect(() => die('boom')).toThrow(LocalExit)
    try {
      die('boom')
    } catch (e) {
      expect(e).toBeInstanceOf(LocalExit)
      expect(/** @type {LocalExit} */ (e).message).toBe('boom')
    }
  })
})
