import { createSystem, execSync } from './system.js'
import { describe, expect, test } from 'bun:test'

describe('quadlet system', () => {
  test('execSync captures stdout and status', () => {
    const r = execSync('bash', ['-c', 'echo hello'], { capture: true })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('hello')
  })

  test('execSync returns 127 when the binary is missing', () => {
    const r = execSync('/no/such/quadlet-bin', [], { capture: true })
    expect(r.status).toBe(127)
  })

  test('createSystem rootful paths use system unit dirs', () => {
    const sys = createSystem({ rootlessUser: 'apps' })
    expect(sys.rootlessUser).toBe('apps')
    expect(sys.paths('rootful')).toEqual({
      engine: 'rootful',
      dest: '/etc/containers/systemd',
      sysDest: '/etc/systemd/system',
      wantedBy: 'multi-user.target',
      asUser: null,
    })
  })
})
