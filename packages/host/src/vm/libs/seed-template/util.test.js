import { withTrailingNewline } from './util.js'
import { describe, expect, test } from 'bun:test'

describe('withTrailingNewline', () => {
  test('returns null for empty', () => {
    expect(withTrailingNewline(null)).toBe(null)
    expect(withTrailingNewline(undefined)).toBe(null)
    expect(withTrailingNewline('')).toBe(null)
  })

  test('appends newline when missing', () => {
    expect(withTrailingNewline('secret')).toBe('secret\n')
    expect(withTrailingNewline('secret\n')).toBe('secret\n')
  })
})
