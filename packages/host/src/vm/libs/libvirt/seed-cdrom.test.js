import { detachSeedCdrom, patchDetachSeedCdromXml } from './seed-cdrom.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  virshMod.virsh.mockRestore?.()
})

const WITH_SEED = `<domain type='kvm'>
  <devices>
    <disk type='file' device='disk'>
      <source file='/var/lib/libvirt/images/os.qcow2'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <disk type='file' device='cdrom'>
      <source file='/home/u/.local/share/qctl/seed/dev/nocloud.iso'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>
  </devices>
</domain>`

describe('patchDetachSeedCdromXml', () => {
  test('returns null when no cdrom', () => {
    expect(
      patchDetachSeedCdromXml(`<domain><devices>
    <disk type='file' device='disk'><source file='/os.qcow2'/></disk>
  </devices></domain>`),
    ).toBeNull()
  })

  test('strips cdrom disks and keeps OS disk', () => {
    const next = patchDetachSeedCdromXml(WITH_SEED)
    expect(next).not.toBeNull()
    expect(next).toContain("device='disk'")
    expect(next).toContain('os.qcow2')
    expect(next).not.toMatch(/device=['"]cdrom['"]/)
    expect(next).not.toContain('nocloud.iso')
  })
})

describe('detachSeedCdrom', () => {
  test('redefines when cdrom present', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        if (cmd === 'domstate') return virshReply(0, 'shut off')
        if (cmd === 'dumpxml') return virshReply(0, WITH_SEED)
        return virshReply(0)
      }),
    )
    expect(await detachSeedCdrom('qemu:///session', 'rocky')).toBe(true)
    expect(cmds).toContain('define')
  })

  test('no-op when already without cdrom', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        if (cmd === 'domstate') return virshReply(0, 'shut off')
        if (cmd === 'dumpxml') {
          return virshReply(
            0,
            `<domain><devices>
    <disk type='file' device='disk'><source file='/os.qcow2'/></disk>
  </devices></domain>`,
          )
        }
        return virshReply(0)
      }),
    )
    expect(await detachSeedCdrom('qemu:///session', 'rocky')).toBe(false)
  })
})
