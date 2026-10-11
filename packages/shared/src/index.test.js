import { QCTL_VERSION, assertNever } from './index.js'
import { describe, expect, test } from 'bun:test'

describe('@qctl/shared exports', () => {
  test('QCTL_VERSION is a semver-ish string', () => {
    expect(QCTL_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('assertNever throws', () => {
    expect(() => assertNever(/** @type {never} */ ('unexpected'))).toThrow(/unexpected/)
    expect(() => assertNever(/** @type {never} */ (1), 'custom')).toThrow('custom')
  })
})
