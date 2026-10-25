import * as loadConfig from '../../../lib/load-config.js'
import * as pveConfig from '../../libs/proxmox/config.js'
import { check } from './check.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { LoadedProvision } from '../../../lib/load-config-types.js' */
/** @import { VmContext } from '../../driver-contract.js' */

afterEach(() => {
  // @ts-expect-error restore
  pveConfig.tryLoadProxmoxConfig.mockRestore?.()
  // @ts-expect-error restore
  loadConfig.loadEnvProvisionSafe.mockRestore?.()
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
    spyOn(loadConfig, 'loadEnvProvisionSafe').mockResolvedValue({
      ok: true,
      provision: /** @type {LoadedProvision} */ (
        /** @type {unknown} */ ({
          paths: ['/tmp/.env.dev'],
          sshAuthorizedKeys: 'ssh-ed25519 AAAA',
          data: {
            qctl: { environments: { dev: { production: false } } },
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
      /** @type {VmContext} */ (
        /** @type {never} */ ({
          env: 'dev',
          name: 'rocky-dev',
          timeout: 120,
          dryRun: false,
        })
      ),
    )
    expect(process.exitCode).toBe(1)
  })
})
