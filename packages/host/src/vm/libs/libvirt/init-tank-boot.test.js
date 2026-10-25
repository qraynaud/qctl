import {
  nextVirtioTarget,
  patchAttachInitTankBootXml,
  patchAttachSeedCdromXml,
  patchRemoveInitTankBootXml,
} from './init-tank-boot.js'
import { describe, expect, test } from 'bun:test'

const baseXml = `<?xml version='1.0'?>
<domain>
  <devices>
    <disk type='file' device='disk'>
      <source file='/vms/rocky/os.qcow2'/>
      <target dev='vda' bus='virtio'/>
      <boot order='1'/>
    </disk>
  </devices>
</domain>
`

describe('libvirt init-tank-boot xml patches', () => {
  test('nextVirtioTarget skips vda', () => {
    expect(nextVirtioTarget(baseXml)).toBe('vdb')
  })

  test('attach then remove disposable boot', () => {
    const attached = patchAttachInitTankBootXml(baseXml, {
      bootDiskPath: '/vms/rocky/init-tank-boot.qcow2',
      target: 'vdb',
    })
    expect(attached).toContain('init-tank-boot')
    expect(attached).toContain("dev='vdb'")
    expect(attached).toContain("order='1'")
    // OS boot order stripped
    expect(attached).not.toMatch(/os\.qcow2[\s\S]*<boot/)

    const cleared = patchRemoveInitTankBootXml(/** @type {string} */ (attached))
    expect(cleared).not.toContain('init-tank-boot')
    expect(cleared).toContain('os.qcow2')
  })

  test('attach seed cdrom when missing', () => {
    const next = patchAttachSeedCdromXml(baseXml, '/tmp/seed.iso')
    expect(next).toContain("device='cdrom'")
    expect(next).toContain('/tmp/seed.iso')
  })
})
