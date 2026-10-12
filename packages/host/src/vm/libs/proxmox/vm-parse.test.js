import { diskSerialFromValue, volidFromDiskValue } from './vm-parse.js'
import { describe, expect, test } from 'bun:test'

describe('vm-parse', () => {
  test('volidFromDiskValue takes first field', () => {
    expect(volidFromDiskValue('local-lvm:vm-100-disk-0,serial=rocky-vw')).toBe(
      'local-lvm:vm-100-disk-0',
    )
    expect(volidFromDiskValue(null)).toBeNull()
  })

  test('diskSerialFromValue extracts serial=', () => {
    expect(diskSerialFromValue('local-lvm:vm-100-disk-0,serial=rocky-vw')).toBe('rocky-vw')
    expect(diskSerialFromValue('local-lvm:vm-100-disk-0')).toBeNull()
  })
})
