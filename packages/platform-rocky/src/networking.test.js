import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'

import { applyDnat, ensureUp, planApplyDnat, planEnsureUp, rockyNetworking } from './networking.js'
import { describe, expect, spyOn, test } from 'bun:test'

/**
 * @param {Record<string, string>} initial
 */
function mockPortsFs(initial = {}) {
  /** @type {Map<string, string>} */
  const files = new Map(Object.entries(initial))
  spyOn(fs, 'existsSync').mockImplementation((p) => files.has(String(p)))
  // @ts-expect-error test stub returns utf8 string
  spyOn(fsp, 'readFile').mockImplementation(async (/** @type {string} */ p) => {
    const key = String(p)
    const body = files.get(key)
    if (body === undefined) {
      const err = /** @type {NodeJS.ErrnoException} */ (new Error(`ENOENT: ${key}`))
      err.code = 'ENOENT'
      throw err
    }
    return body
  })
  spyOn(fsp, 'writeFile').mockImplementation(async (p, data) => {
    files.set(String(p), String(data))
  })
  return files
}

describe('rocky networking', () => {
  test('plan helpers describe egress and DNAT', () => {
    const ctx = {
      env: { QCTL_EGRESS_HOST: '8.8.8.8', QCTL_EGRESS_IFACE: 'eth1' },
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    }
    expect(planEnsureUp(ctx)[0]).toMatch(/8\.8\.8\.8/)
    expect(planApplyDnat(ctx)[0]).toMatch(/ports\.json/)
    expect(rockyNetworking.planEnsureUp).toBe(planEnsureUp)
  })

  test('ensureUp returns early when ping succeeds', async () => {
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await ensureUp({
      env: { QCTL_EGRESS_HOST: '1.1.1.1' },
      log: (l) => logs.push(l),
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(logs[0]).toMatch(/egress OK/)
    expect(cmds).toEqual([['ping', '-c1', '-W2', '1.1.1.1']])
  })

  test('applyDnat skips when ports.json missing', async () => {
    mockPortsFs()
    /** @type {string[]} */
    const logs = []
    await applyDnat({
      env: { QCTL_PORTS_JSON: '/mock/missing-ports.json' },
      log: (l) => logs.push(l),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    expect(logs[0]).toMatch(/skipping DNAT/)
  })

  test('applyDnat skips when no dnat entries', async () => {
    const portsJson = '/mock/ports.json'
    mockPortsFs({
      [portsJson]: JSON.stringify({
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      }),
    })
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await applyDnat({
      env: { QCTL_PORTS_JSON: portsJson },
      log: (l) => logs.push(l),
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(logs[0]).toMatch(/no ports with dnat/)
    expect(cmds).toEqual([])
  })

  test('applyDnat writes sysctl and firewall-cmd for dnat ports', async () => {
    const portsJson = '/mock/ports.json'
    const routeConf = '/mock/90-rocky-route-localnet.conf'
    mockPortsFs({
      [portsJson]: JSON.stringify({
        ssh: { port: 22, forward: 2222 },
        https: { port: 443, dnat: 8443 },
      }),
    })
    /** @type {string[][]} */
    const cmds = []
    await applyDnat({
      env: { QCTL_PORTS_JSON: portsJson, QCTL_ROUTE_LOCALNET_CONF: routeConf },
      log: () => {},
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(fsp.writeFile).toHaveBeenCalledWith(
      routeConf,
      expect.stringContaining('route_localnet=1'),
    )
    expect(cmds.some((c) => c[0] === 'sysctl' && c[1] === '-p' && c[2] === routeConf)).toBe(true)
    expect(
      cmds.some(
        (c) =>
          c[0] === 'firewall-cmd'
          && c.includes('--add-forward-port=port=443:proto=tcp:toport=8443:toaddr=127.0.0.1'),
      ),
    ).toBe(true)
  })
})
