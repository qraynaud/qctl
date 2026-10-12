import { patchSerialNullXml, patchSerialTcpXml, restartWithSerialNull } from './serial.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const DEVICES = `<domain type='kvm'>
  <devices>
    <serial type='pty'>
      <target type='isa-serial' port='0'/>
    </serial>
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
  </devices>
</domain>`

describe('patchSerialTcpXml', () => {
  test('replaces pty serial/console with tcp connect', () => {
    const next = patchSerialTcpXml(DEVICES, 5555)
    expect(next).toContain("type='tcp'")
    expect(next).toContain("service='5555'")
    expect(next).toContain("mode='connect'")
    expect(next).not.toContain("type='pty'")
  })

  test('inserts serial+console when missing', () => {
    const xml = `<domain><devices>\n  </devices></domain>`
    const next = patchSerialTcpXml(xml, 9)
    expect(next).toContain("<serial type='tcp'>")
    expect(next).toContain("<console type='tcp'>")
    expect(next).toContain("service='9'")
  })
})

describe('patchSerialNullXml', () => {
  test('returns null when already null', () => {
    const xml = `<domain><devices>
    <serial type='null'><target type='isa-serial' port='0'/></serial>
  </devices></domain>`
    expect(patchSerialNullXml(xml)).toBeNull()
  })

  test('converts pty serial to null', () => {
    const next = patchSerialNullXml(DEVICES)
    expect(next).not.toBeNull()
    expect(next).toContain("type='null'")
    expect(next).not.toContain("type='pty'")
  })
})

describe('restartWithSerialNull', () => {
  afterEach(() => {
    // @ts-expect-error restore
    virshMod.virsh.mockRestore?.()
  })

  test('no-ops when serial is already null', async () => {
    const xml = `<domain><devices>
    <serial type='null'><target type='isa-serial' port='0'/></serial>
  </devices></domain>`
    /** @type {string[][]} */
    const calls = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd, ...args) => {
        calls.push([cmd, ...args])
        if (cmd === 'dumpxml') return virshReply(0, xml)
        return virshReply(0)
      }),
    )
    expect(await restartWithSerialNull('qemu:///session', 'demo')).toBe(false)
    expect(calls.map((c) => c[0])).toEqual(['dumpxml'])
  })
})
