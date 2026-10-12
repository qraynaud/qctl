import { ensureDefaultNetwork } from './network.js'
import { routeVirsh, virshReply } from './test-virsh.js'
import * as virshMod from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  virshMod.virsh.mockRestore?.()
})

describe('ensureDefaultNetwork', () => {
  test('skips session URIs without calling virsh', async () => {
    /** @type {string[][]} */
    const calls = []
    spyOn(virshMod, 'virsh').mockImplementation((...args) => {
      calls.push(args)
      return virshReply(0)
    })
    await ensureDefaultNetwork('qemu:///session')
    expect(calls).toEqual([])
  })

  test('no-ops when default is already active', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        if (cmd === 'net-list') {
          return virshReply(0, ' Name      State\n default   active\n')
        }
        return virshReply(0)
      }),
    )
    await ensureDefaultNetwork('qemu:///system')
    expect(cmds).toEqual(['net-list'])
  })

  test('starts inactive default network', async () => {
    /** @type {string[]} */
    const cmds = []
    spyOn(virshMod, 'virsh').mockImplementation(
      routeVirsh((_c, cmd) => {
        cmds.push(cmd)
        if (cmd === 'net-list') {
          return virshReply(0, ' Name      State\n default   inactive\n')
        }
        return virshReply(0)
      }),
    )
    await ensureDefaultNetwork('qemu:///system')
    expect(cmds).toEqual(['net-list', 'net-start', 'net-autostart'])
  })
})
