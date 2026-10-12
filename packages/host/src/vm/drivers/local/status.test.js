import * as paths from '../../../lib/paths.js'
import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import { virshReply } from '../../libs/libvirt/test-virsh.js'
import { status } from './status.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.requireBins.mockRestore?.()
  // @ts-expect-error restore
  libvirt.virsh.mockRestore?.()
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('local status', () => {
  test('prints not defined when domain missing', async () => {
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'virsh').mockImplementation(() => virshReply(1, '', 'not found'))
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await status(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        network: 'user',
        env: 'dev',
        target: 'local',
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/not defined/)
  })

  test('prints dominfo when domain exists', async () => {
    spyOn(util, 'requireBins').mockResolvedValue(undefined)
    spyOn(libvirt, 'virsh').mockImplementation(() => virshReply(0, 'Id: 1\nName: rocky\n'))
    const log = spyOn(console, 'log').mockImplementation(() => {})
    // Avoid SSH hint side effects that need repo/virsh
    const sshHints = await import('../../libs/ssh-hints.js')
    spyOn(sshHints, 'printLocalSshInfo').mockResolvedValue(undefined)
    await status(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        name: 'rocky',
        network: 'user',
        env: 'dev',
        target: 'local',
      }),
    )
    expect(String(log.mock.calls[0]?.[0])).toMatch(/Name: rocky/)
  })
})
