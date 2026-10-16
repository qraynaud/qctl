import * as loadConfig from '../../../lib/load-config.js'
import * as paths from '../../../lib/paths.js'
import { loadProxmoxConfig, tryLoadProxmoxConfig } from './config.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { LoadedProvision } from '../../../lib/load-config-types.js' */

afterEach(() => {
  // @ts-expect-error restore
  paths.tryGetRepoRoot.mockRestore?.()
  // @ts-expect-error restore
  loadConfig.loadEnvProvision.mockRestore?.()
  // @ts-expect-error restore
  loadConfig.loadEnvProvisionSafe.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('proxmox config', () => {
  test('tryLoadProxmoxConfig fails outside instance repo', async () => {
    spyOn(paths, 'tryGetRepoRoot').mockReturnValue(null)
    const r = await tryLoadProxmoxConfig({ env: 'dev' })
    expect(r.usable).toBe(false)
    expect(r.errors[0]).toMatch(/instance repo/)
  })

  test('loadProxmoxConfig builds config from provision', async () => {
    spyOn(loadConfig, 'loadEnvProvision').mockResolvedValue(
      /** @type {Awaited<ReturnType<typeof loadConfig.loadEnvProvision>>} */ (
        /** @type {never} */ ({
          path: '/tmp/provision/.env.dev',
          provisionDir: '/tmp/provision',
          paths: ['/tmp/provision/.env.dev'],
          proxmox: {
            api_url: 'https://pve.example/',
            api_token: 'user@pve!tok=secret',
            node: 'pve',
            storage: 'local-lvm',
            image_storage: 'local',
          },
          nets: [{ bridge: 'vmbr0' }],
        })
      ),
    )
    const cfg = await loadProxmoxConfig({ env: 'dev' })
    expect(cfg.apiUrl).toBe('https://pve.example')
    expect(cfg.node).toBe('pve')
    expect(cfg.storage).toBe('local-lvm')
  })

  test('tryLoadProxmoxConfig marks usable when fields present', async () => {
    spyOn(paths, 'tryGetRepoRoot').mockReturnValue('/tmp/instance')
    spyOn(loadConfig, 'loadEnvProvisionSafe').mockResolvedValue({
      ok: true,
      provision: /** @type {LoadedProvision} */ (
        /** @type {unknown} */ ({
          path: '/tmp/provision/.env.dev',
          provisionDir: '/tmp/provision',
          paths: ['/tmp/provision/.env.dev'],
          proxmox: {
            api_url: 'https://pve.example',
            api_token: 'user@pve!tok=secret',
            node: 'pve',
          },
          nets: [],
        })
      ),
    })
    const r = await tryLoadProxmoxConfig({ env: 'dev' })
    expect(r.usable).toBe(true)
    expect(r.config?.node).toBe('pve')
  })
})
