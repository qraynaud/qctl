import { trunksSchema } from './networking.js'
import { describe, expect, test } from 'bun:test'

describe('trunksSchema', () => {
  test('omitted → undefined; empty list rejected', () => {
    expect(trunksSchema.parse(undefined)).toBeUndefined()
    expect(() => trunksSchema.parse([])).toThrow()
  })

  test('expands ids and ranges into sorted unique ints', () => {
    expect(trunksSchema.parse([10, '12-14', 11])).toEqual([10, 11, 12, 13, 14])
  })

  test('rejects bad ranges', () => {
    expect(() => trunksSchema.parse(['20-10'])).toThrow(/bad trunk range/)
    expect(() => trunksSchema.parse(['abc'])).toThrow()
  })
})
