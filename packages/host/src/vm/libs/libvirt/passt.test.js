import { patchPasstPortForwardsXml, reconcilePasstPortForwards } from './passt.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { PortsMap } from '../../types.js' */

/** @type {PortsMap} */
const ports = {
  ssh: { port: 22, forward: 2222 },
  cockpit: { port: 9090, forward: 9090 },
}

afterEach(() => {
  // @ts-expect-error restore
  virshMod.virsh.mockRestore?.()
})

const PASST_IFACE = `
  <interface type='user'>
    <backend type='passt'/>
    <portForward proto='tcp' address='127.0.0.1'>
      <range start='2222' to='22'/>
    </portForward>
    <portForward proto='tcp' address='127.0.0.1'>
      <range start='9090' to='9090'/>
    </portForward>
    <model type='virtio'/>
  </interface>`

describe('patchPasstPortForwardsXml', () => {
  test('returns null when no passt interface', () => {
    const xml = `<domain><devices>
  <interface type='network'><source network='default'/></interface>
</devices></domain>`
    expect(patchPasstPortForwardsXml(xml, ports)).toBeNull()
  })

  test('returns null when forwards already match', () => {
    const xml = `<domain><devices>${PASST_IFACE}
</devices></domain>`
    expect(patchPasstPortForwardsXml(xml, ports)).toBeNull()
  })

  test('rewrites stale portForward entries', () => {
    const stale = PASST_IFACE.replace("start='2222'", "start='2200'")
    const xml = `<domain><devices>${stale}
</devices></domain>`
    const next = patchPasstPortForwardsXml(xml, ports)
    expect(next).not.toBeNull()
    expect(next).toContain("start='2222'")
    expect(next).toContain("to='22'")
    expect(next).toContain("start='9090'")
    expect(next).toContain("to='9090'")
    expect(next).not.toContain("start='2200'")
  })

  test('returns null when ports have no forwards', () => {
    const xml = `<domain><devices>${PASST_IFACE}
</devices></domain>`
    expect(
      patchPasstPortForwardsXml(xml, {
        ssh: { port: 22 },
        cockpit: { port: 9090 },
      }),
    ).toBeNull()
  })
})

describe('reconcilePasstPortForwards', () => {
  test('returns false when xml already matches', async () => {
    const xml = `<domain><devices>${PASST_IFACE}
</devices></domain>`
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => (cmd === 'dumpxml' ? virshReply(0, xml) : virshReply(0))),
    )
    expect(await reconcilePasstPortForwards('qemu:///session', 'a', ports)).toBe(false)
  })
})
