import { deepMerge } from './merge.js'
import { describe, expect, test } from 'bun:test'

describe('deepMerge', () => {
  test('returns overlay when base is not a plain object', () => {
    expect(deepMerge(1, { a: 2 })).toEqual({ a: 2 })
    expect(deepMerge(null, 'x')).toBe('x')
  })

  test('returns base when overlay is undefined', () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 })
  })

  test('null overlay wins', () => {
    expect(deepMerge({ a: 1 }, null)).toBeNull()
  })

  test('merges nested maps by key', () => {
    const out = deepMerge(
      {
        networking: {
          ports: { ssh: { port: 22 } },
          interfaces: { vlan2: { type: 'dummy', ipv4: { addresses: '10.0.0.1/24' } } },
        },
      },
      {
        networking: {
          interfaces: {
            vlan2: { type: 'vlan', id: 2, parent: 'main' },
            vlan3: { type: 'dummy' },
          },
        },
      },
    )
    expect(out).toEqual({
      networking: {
        ports: { ssh: { port: 22 } },
        interfaces: {
          vlan2: {
            type: 'vlan',
            id: 2,
            parent: 'main',
            ipv4: { addresses: '10.0.0.1/24' },
          },
          vlan3: { type: 'dummy' },
        },
      },
    })
  })

  test('replaces arrays instead of concatenating', () => {
    expect(deepMerge({ keys: ['a'] }, { keys: ['b', 'c'] })).toEqual({
      keys: ['b', 'c'],
    })
  })
})
