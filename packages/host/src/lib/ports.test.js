import { PORT_CLI, passtDesiredFingerprint, passtForwards, resolvePorts } from './ports.js'
import { describe, expect, test } from 'bun:test'

/** @import { PortEntry } from '../vm/types.js' */

/** @type {PortEntry[]} */
const sample = [
  { name: 'ssh', port: 22, forward: 2222, dnat: null },
  { name: 'http', port: 80, forward: 8080, dnat: null },
  { name: 'https', port: 443, forward: null, dnat: null },
]

describe('ports helpers', () => {
  test('PORT_CLI maps named services to CLI flags', () => {
    expect(PORT_CLI.ssh.option).toBe('ssh-port')
    expect(PORT_CLI.http.argvKey).toBe('caddyHttpPort')
  })

  test('resolvePorts applies CLI forward overrides', () => {
    const out = resolvePorts(sample, { sshPort: 2200 })
    expect(out.find((p) => p.name === 'ssh')?.forward).toBe(2200)
    expect(out.find((p) => p.name === 'http')?.forward).toBe(8080)
  })

  test('passtForwards drops entries without forward', () => {
    expect(passtForwards(sample).map((p) => p.name)).toEqual(['ssh', 'http'])
  })

  test('passtDesiredFingerprint is stable and sorted', () => {
    expect(passtDesiredFingerprint(sample)).toBe(
      ['tcp|127.0.0.1|2222|22', 'tcp|127.0.0.1|8080|80'].sort().join(';'),
    )
  })
})
