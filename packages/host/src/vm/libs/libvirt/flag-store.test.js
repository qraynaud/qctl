import { INSTALLED } from '../flags.js'
import { createFlagStore, patchDomainFlagXml, readFlagWireFromXml } from './flag-store.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const NS = 'https://qctl.dev/vm'

const BARE = `<domain type='kvm'>
  <name>rocky</name>
  <devices>
    <disk type='file'/>
  </devices>
</domain>`

const WITH_INSTALLED = `<domain type='kvm'>
  <name>rocky</name>
  <metadata>
    <qctl:installed xmlns:qctl="${NS}">true</qctl:installed>
  </metadata>
  <devices>
    <disk type='file'/>
  </devices>
</domain>`

const OTHER_META = `<domain type='kvm'>
  <name>rocky</name>
  <metadata>
    <libosinfo:libosinfo xmlns:libosinfo="http://libosinfo.org/xmlns/libvirt/domain/1.0"/>
  </metadata>
  <devices/>
</domain>`

describe('readFlagWireFromXml / patchDomainFlagXml', () => {
  test('reads installed wire', () => {
    expect(readFlagWireFromXml(WITH_INSTALLED, 'installed')).toBe('true')
    expect(readFlagWireFromXml(BARE, 'installed')).toBeUndefined()
  })

  test('inserts metadata before devices', () => {
    const next = patchDomainFlagXml(BARE, 'installed', 'true')
    expect(next).not.toBeNull()
    expect(readFlagWireFromXml(/** @type {string} */ (next), 'installed')).toBe('true')
  })

  test('returns null when unchanged', () => {
    expect(patchDomainFlagXml(WITH_INSTALLED, 'installed', 'true')).toBeNull()
  })

  test('clears flag and drops empty metadata', () => {
    const next = patchDomainFlagXml(WITH_INSTALLED, 'installed', undefined)
    expect(next).not.toBeNull()
    expect(readFlagWireFromXml(/** @type {string} */ (next), 'installed')).toBeUndefined()
    expect(next).not.toMatch(/<metadata/i)
  })

  test('preserves other metadata when clearing', () => {
    const withBoth = `<domain>
  <metadata>
    <libosinfo:libosinfo xmlns:libosinfo="http://libosinfo.org/xmlns/libvirt/domain/1.0"/>
    <qctl:installed xmlns:qctl="${NS}">true</qctl:installed>
  </metadata>
  <devices/>
</domain>`
    const next = patchDomainFlagXml(withBoth, 'installed', undefined)
    expect(next).toContain('libosinfo')
    expect(readFlagWireFromXml(/** @type {string} */ (next), 'installed')).toBeUndefined()
  })

  test('merges into existing metadata', () => {
    const next = patchDomainFlagXml(OTHER_META, 'installed', 'false')
    expect(next).toContain('libosinfo')
    expect(readFlagWireFromXml(/** @type {string} */ (next), 'installed')).toBe('false')
  })
})

describe('createFlagStore (VmFlagStore)', () => {
  afterEach(() => {
    // @ts-expect-error restore
    virshMod.virsh.mockRestore?.()
    // @ts-expect-error restore
    console.log.mockRestore?.()
  })

  test('same method surface as Proxmox; get decodes INSTALLED', async () => {
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => (cmd === 'dumpxml' ? virshReply(0, WITH_INSTALLED) : virshReply(0))),
    )
    const store = createFlagStore('qemu:///session', 'rocky')
    expect(Object.keys(store).sort()).toEqual(['delete', 'entry', 'get', 'has', 'set'])
    expect(await store.has(INSTALLED)).toBe(true)
    expect(await store.get(INSTALLED)).toBe(true)
    const e = await store.entry(INSTALLED)
    expect(e).toEqual({ name: 'installed', schema: INSTALLED.schema, value: true })
  })

  test('set no-ops when wire unchanged', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        return cmd === 'dumpxml' ? virshReply(0, WITH_INSTALLED) : virshReply(0)
      }),
    )
    await createFlagStore('qemu:///session', 'rocky').set(INSTALLED, true)
    expect(cmds).toEqual(['dumpxml'])
  })

  test('set redefine when missing', async () => {
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
    await createFlagStore('qemu:///session', 'rocky').set(INSTALLED, true)
    expect(cmds).toContain('define')
  })
})
