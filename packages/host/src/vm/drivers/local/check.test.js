import * as loadConfig from '../../../lib/load-config.js'
import * as paths from '../../../lib/paths.js'
import * as util from '../../../lib/util.js'
import * as libvirt from '../../libs/libvirt/index.js'
import { virshReply } from '../../libs/libvirt/test-virsh.js'
import { check } from './check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  util.which.mockRestore?.()
  // @ts-expect-error restore
  libvirt.virsh.mockRestore?.()
  // @ts-expect-error restore
  loadConfig.loadEnvSecrets.mockRestore?.()
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

describe('local check', () => {
  test('reports OK when tools, libvirt, and secrets are present', async () => {
    spyOn(util, 'which').mockResolvedValue('/usr/bin/tool')
    spyOn(paths, 'getImages').mockReturnValue('/tmp/qctl-test/images')
    spyOn(paths, 'getSeed').mockReturnValue('/tmp/qctl-test/seed')
    spyOn(paths, 'getVms').mockReturnValue('/tmp/qctl-test/vms')
    spyOn(libvirt, 'virsh').mockImplementation((_c, cmd) => {
      if (cmd === 'version') return virshReply(0, 'libvirt 10\n')
      if (cmd === 'net-list') return virshReply(0, ' Name      State\n default   active\n')
      return virshReply(0)
    })
    spyOn(loadConfig, 'loadEnvSecrets').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof loadConfig.loadEnvSecrets>>} */ ({
        paths: ['/tmp/.env.dev'],
        sshAuthorizedKeys: 'ssh-ed25519 AAAA',
        guest: { TANK_PASSPHRASE: 'x' },
      }),
    )
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})

    await check(
      /** @type {VmArgv} */ ({
        connect: 'qemu:///system',
        env: 'dev',
        target: 'local',
      }),
    )
    expect(process.exitCode || 0).toBe(0)
  })
})
