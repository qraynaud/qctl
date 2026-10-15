import { passtDesiredFingerprint, passtForwards, portByName } from './ports.js'
import { describe, expect, spyOn, test } from 'bun:test'

/** @import { PortsMap } from '../vm/types.js' */

/** @type {PortsMap} */
const sample = {
  ssh: { port: 22, forward: 2222 },
  cockpit: { port: 9090, forward: 9090 },
  http: { port: 80, forward: 8080 },
  https: { port: 443 },
}

describe('ports helpers', () => {
  test('passtForwards drops entries without forward', () => {
    expect(passtForwards(sample).map(([name]) => name)).toEqual(['ssh', 'cockpit', 'http'])
  })

  test('passtDesiredFingerprint is stable and sorted', () => {
    expect(passtDesiredFingerprint(sample)).toBe(
      ['tcp|127.0.0.1|2222|22', 'tcp|127.0.0.1|8080|80', 'tcp|127.0.0.1|9090|9090']
        .sort()
        .join(';'),
    )
  })

  test('portByName returns the entry or dies', () => {
    expect(portByName(sample, 'ssh').port).toBe(22)
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    try {
      expect(() => portByName(sample, 'missing')).toThrow(/exit 1/)
    } finally {
      exit.mockRestore()
    }
  })
})
