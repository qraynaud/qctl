import * as loadConfig from '../../../lib/load-config.js'
import * as paths from '../../../lib/paths.js'
import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import { virshReply } from '../../libs/libvirt/test-virsh.js'
import { check } from './check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { LoadedProvision } from '../../../lib/load-config-types.js' */
/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.which.mockRestore?.()
  // @ts-expect-error restore
  libvirt.virsh.mockRestore?.()
  // @ts-expect-error restore
  loadConfig.loadEnvProvisionSafe.mockRestore?.()
  // @ts-expect-error restore
  paths.getImages.mockRestore?.()
  // @ts-expect-error restore
  paths.getSeed.mockRestore?.()
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('workstation check', () => {
  test('reports OK when tools, libvirt, and provision is present', async () => {
    /** @type {string[]} */
    const whichBins = []
    spyOn(util, 'which').mockImplementation(async (bin) => {
      whichBins.push(bin)
      return `/usr/bin/${bin}`
    })
    spyOn(paths, 'getImages').mockReturnValue('/tmp/qctl-test/images')
    spyOn(paths, 'getSeed').mockReturnValue('/tmp/qctl-test/seed')
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(libvirt, 'virsh').mockImplementation((_c, cmd) => {
      if (cmd === 'version') return virshReply(0, 'libvirt 10\n')
      if (cmd === 'net-list') return virshReply(0, ' Name      State\n default   active\n')
      return virshReply(0)
    })
    spyOn(loadConfig, 'loadEnvProvisionSafe').mockResolvedValue({
      ok: true,
      provision: /** @type {LoadedProvision} */ (
        /** @type {unknown} */ ({
          paths: ['/tmp/.env.dev'],
          sshAuthorizedKeys: 'ssh-ed25519 AAAA',
          data: {
            disks: {
              tanks: { tank: { id: 'tank', passphrase: 'x' } },
            },
          },
          guest: { tank_passphrase_tank: 'x' },
        })
      ),
    })
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})

    await check(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        env: 'dev',
        target: 'workstation',
      }),
    )
    expect(process.exitCode || 0).toBe(0)
    expect(whichBins).toContain('swtpm')
  })

  test('fails when swtpm is missing', async () => {
    spyOn(util, 'which').mockImplementation(async (bin) =>
      bin === 'swtpm' ? null : `/usr/bin/${bin}`,
    )
    spyOn(paths, 'getImages').mockReturnValue('/tmp/qctl-test/images')
    spyOn(paths, 'getSeed').mockReturnValue('/tmp/qctl-test/seed')
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(libvirt, 'virsh').mockImplementation((_c, cmd) => {
      if (cmd === 'version') return virshReply(0, 'libvirt 10\n')
      if (cmd === 'net-list') return virshReply(0, ' Name      State\n default   active\n')
      return virshReply(0)
    })
    spyOn(loadConfig, 'loadEnvProvisionSafe').mockResolvedValue({
      ok: true,
      provision: /** @type {LoadedProvision} */ (
        /** @type {unknown} */ ({
          paths: ['/tmp/.env.dev'],
          sshAuthorizedKeys: 'ssh-ed25519 AAAA',
          data: {
            disks: {
              tanks: { tank: { id: 'tank', passphrase: 'x' } },
            },
          },
          guest: { tank_passphrase_tank: 'x' },
        })
      ),
    })
    /** @type {string[]} */
    const logs = []
    spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })

    await check(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        env: 'dev',
        target: 'workstation',
      }),
    )
    expect(process.exitCode).toBe(1)
    expect(logs.join('\n')).toMatch(/swtpm not found/)
    expect(logs.join('\n')).toMatch(/emulated TPM/)
  })
})
