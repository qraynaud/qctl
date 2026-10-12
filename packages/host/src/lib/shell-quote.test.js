import { shellQuote } from './shell-quote.js'
import { describe, expect, test } from 'bun:test'

describe('shellQuote', () => {
  test('wraps plain strings in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  test('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})
