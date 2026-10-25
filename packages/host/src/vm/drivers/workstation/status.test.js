import * as paths from '../../../lib/paths.js'
import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import { virshReply } from '../../libs/libvirt/test-virsh.js'
import * as sshHints from '../../libs/ssh-hints.js'
import { getStatus } from './status.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmContext } from '../../driver-contract.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  libvirt.virsh.mockRestore?.()
  // @ts-expect-error restore
  libvirt.domainState.mockRestore?.()
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  sshHints.localSshHints.mockRestore?.()
})

describe('workstation getStatus', () => {
  test('returns absent summary when domain missing', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'domainState').mockResolvedValue(null)
    spyOn(libvirt, 'virsh').mockImplementation(() => virshReply(1, '', 'not found'))
    const snap = await getStatus(
      /** @type {VmContext} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        network: 'user',
        env: 'dev',
        timeout: 120,
        dryRun: false,
      }),
    )
    expect(snap.summary).toMatch(/not defined/)
    expect(snap.power.kind).toBe('absent')
  })

  test('returns dominfo summary when domain exists', async () => {
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'domainState').mockResolvedValue('running')
    spyOn(libvirt, 'virsh').mockImplementation(() => virshReply(0, 'Id: 1\nName: rocky\n'))
    spyOn(sshHints, 'localSshHints').mockResolvedValue({
      title: 'Shell',
      lines: ['qctl vm shell'],
    })
    const snap = await getStatus(
      /** @type {VmContext} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        network: 'user',
        env: 'dev',
        timeout: 120,
        dryRun: false,
      }),
    )
    expect(snap.summary).toMatch(/Name: rocky/)
    expect(snap.hints?.lines).toContain('qctl vm shell')
  })
})
