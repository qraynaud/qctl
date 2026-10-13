import { isCloudInitYamlSafe, withTrailingNewline } from './util.js'
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

describe('isCloudInitYamlSafe', () => {
  test('allows tab/lf/cr and printable text', () => {
    expect(isCloudInitYamlSafe('hello\nworld\t!')).toBe(true)
  })

  test('rejects DEL and other C0 controls', () => {
    expect(isCloudInitYamlSafe(`x${String.fromCharCode(0x7f)}y`)).toBe(false)
    expect(isCloudInitYamlSafe(`x${String.fromCharCode(0x00)}y`)).toBe(false)
    expect(isCloudInitYamlSafe(`x${String.fromCharCode(0x1f)}y`)).toBe(false)
  })
})
