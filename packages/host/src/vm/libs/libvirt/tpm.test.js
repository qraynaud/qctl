import { routeVirsh, virshReply } from './test-virsh.js'
import { patchDomainTpmXml, reconcileDomainTpm } from './tpm.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const BARE = `<domain type='kvm'>
  <devices>
    <disk type='file'/>
  </devices>
</domain>`

const WITH_TPM = `<domain type='kvm'>
  <devices>
    <tpm model='tpm-crb'>
      <backend type='emulator' version='2.0'/>
    </tpm>
  </devices>
</domain>`

describe('patchDomainTpmXml', () => {
  test('inserts emulator TPM 2.0 when missing', () => {
    const next = patchDomainTpmXml(BARE)
    expect(next).not.toBeNull()
    expect(next).toContain("model='tpm-crb'")
    expect(next).toContain("type='emulator'")
    expect(next).toContain("version='2.0'")
  })

  test('returns null when TPM already present', () => {
    expect(patchDomainTpmXml(WITH_TPM)).toBeNull()
  })
})

describe('reconcileDomainTpm', () => {
  afterEach(() => {
    // @ts-expect-error restore
    virshMod.virsh.mockRestore?.()
    // @ts-expect-error restore
    console.log.mockRestore?.()
  })

  test('no-ops when TPM already present', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => (cmd === 'dumpxml' ? virshReply(0, WITH_TPM) : virshReply(0))),
    )
    expect(await reconcileDomainTpm('qemu:///session', 'a')).toBe(false)
  })

  test('stops and redefine when TPM missing', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        if (cmd === 'dumpxml') return virshReply(0, BARE)
        if (cmd === 'domstate') return virshReply(0, 'shut off')
        return virshReply(0)
      }),
    )
    expect(await reconcileDomainTpm('qemu:///session', 'a')).toBe(true)
    expect(cmds).toContain('define')
  })
})
