import * as clientMod from '../../libs/proxmox/client.js'
import * as configMod from '../../libs/proxmox/config.js'
import { clientFrom, ping } from './shared.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  configMod.loadProxmoxConfig.mockRestore?.()
  // @ts-expect-error restore
  clientMod.createProxmoxClient.mockRestore?.()
  // @ts-expect-error restore
  console.log.mockRestore?.()
})

describe('proxmox shared', () => {
  test('clientFrom loads config and creates client', async () => {
    const cfg = /** @type {Awaited<ReturnType<typeof configMod.loadProxmoxConfig>>} */ (
      /** @type {never} */ ({ apiUrl: 'https://pve.example', node: 'pve' })
    )
    spyOn(configMod, 'loadProxmoxConfig').mockResolvedValue(cfg)
    const fake = /** @type {ReturnType<typeof clientMod.createProxmoxClient>} */ (
      /** @type {never} */ ({ config: cfg, version: async () => ({ version: '8.0' }) })
    )
    spyOn(clientMod, 'createProxmoxClient').mockReturnValue(fake)
    const client = await clientFrom({ env: 'dev' })
    expect(client).toBe(fake)
  })

  test('ping logs version', async () => {
    const cfg = /** @type {Awaited<ReturnType<typeof configMod.loadProxmoxConfig>>} */ (
      /** @type {never} */ ({ apiUrl: 'https://pve.example', node: 'pve' })
    )
    spyOn(configMod, 'loadProxmoxConfig').mockResolvedValue(cfg)
    spyOn(clientMod, 'createProxmoxClient').mockReturnValue(
      /** @type {ReturnType<typeof clientMod.createProxmoxClient>} */ (
        /** @type {never} */ ({
          config: cfg,
          version: async () => ({ version: '8.2' }),
        })
      ),
    )
    const log = spyOn(console, 'log').mockImplementation(() => {})
    await ping({ env: 'dev' })
    expect(String(log.mock.calls[0]?.[0])).toMatch(/Proxmox OK/)
  })
})
