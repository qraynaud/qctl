import * as loadConfig from '../../../lib/load-config.js'
import * as pveConfig from '../../libs/proxmox/config.js'
import { check } from './check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  pveConfig.tryLoadProxmoxConfig.mockRestore?.()
  // @ts-expect-error restore
  loadConfig.loadEnvSecrets.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('proxmox check', () => {
  test('reports failures when config is unusable', async () => {
    spyOn(pveConfig, 'tryLoadProxmoxConfig').mockResolvedValue({
      config: null,
      errors: ['missing api'],
      usable: false,
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
        env: 'dev',
        target: 'proxmox',
      }),
    )
    expect(process.exitCode).toBe(1)
  })
})
