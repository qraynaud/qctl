import { expandTrunkList, portsSchema } from './networking.js'
import { describe, expect, test } from 'bun:test'

describe('expandTrunkList', () => {
  test('returns null for empty input', () => {
    expect(expandTrunkList(null)).toBeNull()
    expect(expandTrunkList([])).toBeNull()
  })

  test('expands ids and ranges into sorted unique ints', () => {
    expect(expandTrunkList([10, '12-14', 11])).toEqual([10, 11, 12, 13, 14])
  })

  test('rejects bad ranges', () => {
    expect(() => expandTrunkList(['20-10'])).toThrow(/bad trunk range/)
    expect(() => expandTrunkList(['abc'])).toThrow(/trunk entry/)
  })
})

describe('portsSchema', () => {
  test('parses a named ports map', () => {
    const ports = portsSchema.parse({
      ssh: { port: 22, forward: 2222 },
      http: { port: 80 },
    })
    expect(ports).toEqual([
      { name: 'ssh', port: 22, forward: 2222, dnat: null },
      { name: 'http', port: 80, forward: null, dnat: null },
    ])
  })
})
