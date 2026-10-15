import { dnatEntriesFromPorts, portsSchema } from './ports.js'
import { describe, expect, test } from 'bun:test'

describe('portsSchema', () => {
  test('prefaults ssh + cockpit; extras via catchall', () => {
    expect(portsSchema.parse({})).toEqual({
      ssh: { port: 22, forward: 2222 },
      cockpit: { port: 9090, forward: 9090 },
    })
    expect(portsSchema.parse({ ssh: {}, http: { port: 80 } })).toEqual({
      ssh: { port: 22 },
      cockpit: { port: 9090, forward: 9090 },
      http: { port: 80 },
    })
  })

  test('parses a named ports map', () => {
    const ports = portsSchema.parse({
      ssh: { port: 22, forward: 2222 },
      http: { port: 80 },
    })
    expect(ports).toEqual({
      ssh: { port: 22, forward: 2222 },
      cockpit: { port: 9090, forward: 9090 },
      http: { port: 80 },
    })
  })

  test('rejects null / empty / string forward', () => {
    expect(() => portsSchema.parse({ ssh: { forward: null } })).toThrow()
    expect(() => portsSchema.parse({ http: { port: 80, forward: '' } })).toThrow()
    expect(() => portsSchema.parse({ http: { port: '80' } })).toThrow()
  })
})

describe('dnatEntriesFromPorts', () => {
  test('picks entries with numeric dnat', () => {
    expect(
      dnatEntriesFromPorts({
        ssh: { port: 22, forward: 2222 },
        https: { port: 443, dnat: 8443 },
        bad: { port: 80 },
      }),
    ).toEqual([{ name: 'https', port: 443, dnat: 8443 }])
  })

  test('empty / null → []', () => {
    expect(dnatEntriesFromPorts(null)).toEqual([])
    expect(dnatEntriesFromPorts(undefined)).toEqual([])
    expect(dnatEntriesFromPorts({})).toEqual([])
  })
})
