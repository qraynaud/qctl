import { startProxmoxSerialFollow } from './serial.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ProxmoxClient } from './client.js' */

afterEach(() => {
  // @ts-expect-error restore
  globalThis.fetch.mockRestore?.()
})

describe('proxmox serial', () => {
  test('startProxmoxSerialFollow throws on termproxy HTTP error', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {Response} */ ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: 'denied' }),
      }),
    )
    const client = /** @type {ProxmoxClient} */ ({
      config: {
        apiUrl: 'https://pve.example',
        apiToken: 'user@pve!tok=secret',
        node: 'pve',
      },
    })
    await expect(startProxmoxSerialFollow(client, 101, 'rocky-dev')).rejects.toThrow(
      /termproxy HTTP 403/,
    )
  })
})
