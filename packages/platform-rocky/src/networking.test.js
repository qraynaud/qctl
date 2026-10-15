import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyDnat, ensureUp, planApplyDnat, planEnsureUp, rockyNetworking } from './networking.js'
import { describe, expect, test } from 'bun:test'

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
    /** @type {string[]} */
    const logs = []
    await applyDnat({
      env: { QCTL_PORTS_JSON: '/tmp/qctl-missing-ports.json' },
      log: (l) => logs.push(l),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    })
    expect(logs[0]).toMatch(/skipping DNAT/)
  })

  test('applyDnat skips when no dnat entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qctl-ports-'))
    const portsJson = join(dir, 'ports.json')
    await writeFile(
      portsJson,
      JSON.stringify({ ssh: { port: 22, forward: 2222 }, cockpit: { port: 9090, forward: 9090 } }),
    )
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
    const dir = await mkdtemp(join(tmpdir(), 'qctl-ports-'))
    const portsJson = join(dir, 'ports.json')
    const routeConf = join(dir, '90-rocky-route-localnet.conf')
    await writeFile(
      portsJson,
      JSON.stringify({
        ssh: { port: 22, forward: 2222 },
        https: { port: 443, dnat: 8443 },
      }),
    )
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
