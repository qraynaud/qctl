import { createProxmoxClient } from './client.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @type {ProxmoxConfig} */
const cfg = {
  apiUrl: 'https://pve.example',
  apiToken: 'user@pve!tok=secret',
  node: 'pve',
  storage: 'local-lvm',
  imageStorage: 'local',
  nets: [],
  bridge: 'vmbr0',
  provisionDir: '/tmp',
  env: 'dev',
  provisionPath: '/tmp/.env',
}

/** @import { ProxmoxConfig } from './types.js' */

afterEach(() => {
  // @ts-expect-error restore
  globalThis.fetch.mockRestore?.()
  // @ts-expect-error restore
  process.exit.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
})

describe('createProxmoxClient', () => {
  test('version and findVmidByName via fetch', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(
      /** @type {typeof fetch} */ (
        /** @type {never} */ (
          async (/** @type {RequestInfo | URL} */ input) => {
            const url = String(input)
            if (url.includes('/version')) {
              return /** @type {Response} */ (
                /** @type {never} */ ({
                  ok: true,
                  status: 200,
                  text: async () => JSON.stringify({ data: { version: '8.2' } }),
                })
              )
            }
            if (url.includes('/qemu') && !url.includes('/config')) {
              return /** @type {Response} */ (
                /** @type {never} */ ({
                  ok: true,
                  status: 200,
                  text: async () => JSON.stringify({ data: [{ vmid: 101, name: 'rocky-dev' }] }),
                })
              )
            }
            return /** @type {Response} */ (
              /** @type {never} */ ({
                ok: false,
                status: 404,
                text: async () => JSON.stringify({ message: 'missing' }),
              })
            )
          }
        )
      ),
    )
    const client = createProxmoxClient(cfg)
    expect(await client.version()).toEqual({ version: '8.2' })
    expect(await client.findVmidByName('rocky-dev')).toBe(101)
    expect(await client.findVmidByName('missing')).toBeNull()
  })

  test('softGet returns error object on HTTP failure', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {Response} */ (
        /** @type {never} */ ({
          ok: false,
          status: 403,
          text: async () => JSON.stringify({ message: 'denied' }),
        })
      ),
    )
    const client = createProxmoxClient(cfg)
    const soft = await client.softGet('/nodes/pve/status')
    expect(soft.ok).toBe(false)
    expect(soft.error).toMatch(/403/)
  })
})
