import * as paths from '../../lib/paths.js'
import { ensureDisks, persistentDisks, vmPaths } from './disks.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('disks', () => {
  test('vmPaths and persistentDisks shape', () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    const p = vmPaths('rocky')
    expect(p.os).toBe('/tmp/qctl-test/vms/rocky/os.qcow2')
    expect(p.data).toHaveLength(paths.DATA_COUNT)
    expect(persistentDisks(p)).toContain(p.vw)
    expect(persistentDisks(p)).not.toContain(p.os)
  })

  test('ensureDisks dry-run returns paths without creating', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    const log = spyOn(console, 'log').mockImplementation(() => {})
    const p = await ensureDisks({
      name: 'rocky',
      baseImage: '/tmp/base.qcow2',
      vwSize: '1G',
      dataSize: '1G',
      specialSize: '1G',
      dryRun: true,
    })
    expect(p.dir).toBe('/tmp/qctl-test/vms/rocky')
    expect(String(log.mock.calls[0]?.[0])).toMatch(/would ensure/)
  })
})
