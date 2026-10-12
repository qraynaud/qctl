import { resolveSyncEndpoint } from './endpoint.js'
import { describe, expect, test } from 'bun:test'

/** @import { VmArgv } from '../vm/types.js' */

/**
 * @param {Record<string, string | number | boolean | undefined>} partial
 * @returns {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   remoteDir?: string
 *   identity?: string
 * }}
 */
function argv(partial) {
  /** @type {VmArgv & { user?: string, host?: string, port?: number, remoteDir?: string }} */
  const out = /** @type {never} */ (partial)
  return out
}

describe('resolveSyncEndpoint', () => {
  test('uses explicit --host/--port', async () => {
    const ep = await resolveSyncEndpoint(
      argv({
        host: '10.0.0.5',
        port: 2222,
        user: 'rocky',
        remoteDir: '/tank/rocky',
        target: 'local',
        env: 'dev',
      }),
    )
    expect(ep.host).toBe('10.0.0.5')
    expect(ep.port).toBe(2222)
    expect(ep.username).toBe('rocky')
    expect(ep.label).toContain('10.0.0.5:2222')
  })

  test('proxmox without --host throws', async () => {
    await expect(resolveSyncEndpoint(argv({ target: 'proxmox', env: 'dev' }))).rejects.toThrow(
      /needs --host/,
    )
  })
})
