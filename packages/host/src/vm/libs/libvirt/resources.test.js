import { patchDomainResourcesXml, reconcileDomainResources } from './resources.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  virshMod.virsh.mockRestore?.()
})

const BASE = `<domain>
  <memory unit='KiB'>2097152</memory>
  <currentMemory unit='KiB'>2097152</currentMemory>
  <vcpu placement='static'>2</vcpu>
  <cpu mode='host-passthrough'>
    <topology sockets='2' dies='1' cores='1' threads='1'/>
  </cpu>
</domain>`

describe('patchDomainResourcesXml', () => {
  test('returns null when memory and vcpus already match preferred topology', () => {
    const already = `<domain>
  <memory unit='KiB'>2097152</memory>
  <currentMemory unit='KiB'>2097152</currentMemory>
  <vcpu placement='static'>2</vcpu>
  <cpu mode='host-passthrough'>
    <topology sockets='1' dies='1' cores='2' threads='1'/>
  </cpu>
</domain>`
    expect(patchDomainResourcesXml(already, { memory: 2048, vcpus: 2 })).toBeNull()
  })

  test('updates memory, currentMemory, vcpu, and topology', () => {
    const next = patchDomainResourcesXml(BASE, { memory: 4096, vcpus: 4 })
    expect(next).not.toBeNull()
    expect(next).toContain("<memory unit='KiB'>4194304</memory>")
    expect(next).toContain("<currentMemory unit='KiB'>4194304</currentMemory>")
    expect(next).toContain("<vcpu placement='static'>4</vcpu>")
    expect(next).toContain("<topology sockets='1' dies='1' cores='4' threads='1'/>")
  })

  test('expands self-closing cpu into topology', () => {
    const xml = `<domain>
  <memory unit='MiB'>1024</memory>
  <currentMemory unit='MiB'>1024</currentMemory>
  <vcpu>1</vcpu>
  <cpu mode='host-passthrough'/>
</domain>`
    const next = patchDomainResourcesXml(xml, { memory: 1024, vcpus: 1 })
    expect(next).not.toBeNull()
    expect(next).toMatch(/<cpu mode='host-passthrough'>\s*<topology sockets='1'/)
  })

  test('rejects invalid memory / vcpus', () => {
    expect(() => patchDomainResourcesXml(BASE, { memory: 0, vcpus: 2 })).toThrow(/memory/)
    expect(() => patchDomainResourcesXml(BASE, { memory: 2048, vcpus: 0 })).toThrow(/vcpus/)
  })
})

describe('reconcileDomainResources', () => {
  test('returns false when resources already match', async () => {
    const already = `<domain>
  <memory unit='KiB'>2097152</memory>
  <currentMemory unit='KiB'>2097152</currentMemory>
  <vcpu placement='static'>2</vcpu>
  <cpu mode='host-passthrough'>
    <topology sockets='1' dies='1' cores='2' threads='1'/>
  </cpu>
</domain>`
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => (cmd === 'dumpxml' ? virshReply(0, already) : virshReply(0))),
    )
    expect(await reconcileDomainResources('qemu:///session', 'a', { memory: 2048, vcpus: 2 })).toBe(
      false,
    )
  })
})
