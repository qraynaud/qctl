import {
  assertLocalAttachModes,
  assertProxmoxAttachModes,
  byIdPath,
  summarizeAttachModes,
  withAttachModes,
} from './attach-mode.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const members = [
  { id: 'os', kind: /** @type {const} */ ('os'), size: '20G' },
  { id: 'vw', kind: /** @type {const} */ ('data'), size: '2G' },
  { id: 'rocky-data0', kind: /** @type {const} */ ('tank'), role: /** @type {const} */ ('data') },
]

afterEach(() => {
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

/**
 * @returns {ReturnType<typeof spyOn>}
 */
function mockDieExit() {
  spyOn(console, 'error').mockImplementation(() => {})
  return spyOn(process, 'exit').mockImplementation(
    /** @returns {never} */ () => {
      throw new Error('exit')
    },
  )
}

describe('attach-mode', () => {
  test('withAttachModes: size → virtual, else physical', () => {
    const c = withAttachModes(members)
    expect(c.map((m) => m.mode)).toEqual(['virtual', 'virtual', 'physical'])
  })

  test('assertLocalAttachModes rejects virtual when by-id exists', () => {
    mockDieExit()
    expect(() =>
      assertLocalAttachModes(withAttachModes([{ id: 'vw', kind: 'data', size: '2G' }]), {
        qcowPath: (id) => `/vms/${id}.qcow2`,
        byIdExists: () => true,
        qcowExists: () => false,
      }),
    ).toThrow(/exit/)
  })

  test('assertLocalAttachModes rejects missing physical', () => {
    mockDieExit()
    expect(() =>
      assertLocalAttachModes(withAttachModes([{ id: 'disk0', kind: 'data' }]), {
        qcowPath: (id) => `/vms/${id}.qcow2`,
        byIdExists: () => false,
        qcowExists: () => false,
      }),
    ).toThrow(/exit/)
  })

  test('assertLocalAttachModes accepts physical via qcow', () => {
    expect(() =>
      assertLocalAttachModes(withAttachModes([{ id: 'disk0', kind: 'data' }]), {
        qcowPath: (id) => `/vms/${id}.qcow2`,
        byIdExists: () => false,
        qcowExists: () => true,
      }),
    ).not.toThrow()
  })

  test('assertProxmoxAttachModes requires serial for physical', () => {
    mockDieExit()
    expect(() =>
      assertProxmoxAttachModes(withAttachModes([{ id: 'disk0', kind: 'data' }]), {}),
    ).toThrow(/exit/)
    expect(() =>
      assertProxmoxAttachModes(withAttachModes([{ id: 'disk0', kind: 'data' }]), {
        disk0: 'local-lvm:vm-1-disk-0',
      }),
    ).not.toThrow()
  })

  test('summarizeAttachModes', () => {
    expect(summarizeAttachModes(withAttachModes(members))).toContain('os(20G)')
    expect(summarizeAttachModes(withAttachModes(members))).toContain('rocky-data0(physical)')
    expect(byIdPath('vw')).toBe('/dev/disk/by-id/vw')
  })
})
