import * as fsp from 'node:fs/promises'

import { applyDnat, ensureUp, planApplyDnat, planEnsureUp, rockyNetworking } from './networking.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('rocky networking', () => {
  test('plan helpers describe egress and DNAT', () => {
    const ctx = {
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    }
    expect(planEnsureUp(ctx)[0]).toMatch(/1\.1\.1\.1/)
    expect(planApplyDnat(ctx)[0]).toMatch(/DNAT skipped/)
    expect(rockyNetworking.planEnsureUp).toBe(planEnsureUp)
  })

  test('ensureUp returns early when ping succeeds', async () => {
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await ensureUp({
      log: (l) => logs.push(l),
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(logs[0]).toMatch(/egress OK/)
    expect(cmds).toEqual([['ping', '-c1', '-W2', '1.1.1.1']])
  })

  test('applyDnat skips when seed ports missing', async () => {
    /** @type {string[]} */
    const logs = []
    await applyDnat({
      log: (l) => logs.push(l),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    expect(logs[0]).toMatch(/no seed ports/)
  })

  test('applyDnat uses ctx.ports from seed', async () => {
    spyOn(fsp, 'writeFile').mockImplementation(async () => {})
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await applyDnat({
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
        https: { port: 443, dnat: 8443 },
      },
      log: (l) => logs.push(l),
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(logs.some((l) => l.includes('seed config'))).toBe(true)
    expect(
      cmds.some((c) =>
        c.includes('--add-forward-port=port=443:proto=tcp:toport=8443:toaddr=127.0.0.1'),
      ),
    ).toBe(true)
  })

  test('applyDnat skips when no dnat entries', async () => {
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await applyDnat({
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
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
    const routeConf = '/mock/90-rocky-route-localnet.conf'
    spyOn(fsp, 'writeFile').mockImplementation(async () => {})
    /** @type {string[][]} */
    const cmds = []
    await applyDnat({
      routeLocalnetConf: routeConf,
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
        https: { port: 443, dnat: 8443 },
      },
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
