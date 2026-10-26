import * as fsp from 'node:fs/promises'

import {
  applyDnat,
  applyInterfaces,
  egressIface,
  ensureUp,
  nmConnectionAddArgv,
  nmL3Args,
  planApplyDnat,
  planEnsureUp,
  rockyNetworking,
} from './networking.js'
import { describe, expect, spyOn, test } from 'bun:test'

describe('nmL3Args / nmConnectionAddArgv', () => {
  test('dhcp ethernet → ipv4.method auto', () => {
    expect(nmL3Args({ ipv4: { dhcp: true } })).toEqual(['ipv4.method', 'auto'])
  })

  test('static ipv4 + dns', () => {
    expect(
      nmL3Args({
        ipv4: { dhcp: false, addresses: ['10.0.0.2/24'], gateway: '10.0.0.1' },
        nameservers: ['1.1.1.1', '8.8.8.8'],
      }),
    ).toEqual([
      'ipv4.method',
      'manual',
      'ipv4.addresses',
      '10.0.0.2/24',
      'ipv4.gateway',
      '10.0.0.1',
      'ipv4.dns',
      '1.1.1.1,8.8.8.8',
    ])
  })

  test('ethernet add argv', () => {
    expect(
      nmConnectionAddArgv(
        'main',
        { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
        { main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } } },
      ),
    ).toEqual([
      'connection',
      'add',
      'type',
      'ethernet',
      'ifname',
      'eth0',
      'con-name',
      'qctl-eth0',
      'ipv4.method',
      'auto',
    ])
  })

  test('vlan add argv resolves parent iface', () => {
    const ifaces = {
      main: { type: /** @type {const} */ ('ethernet'), iface: 'enp0s1' },
      apps: {
        type: /** @type {const} */ ('vlan'),
        iface: 'enp0s1.2',
        id: 2,
        parent: 'main',
        ipv4: { dhcp: false, addresses: ['10.0.2.10/24'] },
      },
    }
    expect(nmConnectionAddArgv('apps', ifaces.apps, ifaces)).toEqual([
      'connection',
      'add',
      'type',
      'vlan',
      'con-name',
      'qctl-enp0s1.2',
      'ifname',
      'enp0s1.2',
      'dev',
      'enp0s1',
      'id',
      '2',
      'ipv4.method',
      'manual',
      'ipv4.addresses',
      '10.0.2.10/24',
    ])
  })

  test('vlan without parent → null', () => {
    expect(
      nmConnectionAddArgv('apps', { type: 'vlan', iface: 'eth0.2', id: 2, parent: 'missing' }, {}),
    ).toBeNull()
  })
})

describe('egressIface', () => {
  test('prefers dhcp ethernet, else gateway, else first, else eth0', () => {
    expect(egressIface(undefined)).toBe('eth0')
    expect(
      egressIface({
        a: { type: 'ethernet', iface: 'enp1s0', ipv4: { dhcp: false } },
        b: { type: 'ethernet', iface: 'enp2s0', ipv4: { dhcp: true } },
      }),
    ).toBe('enp2s0')
    expect(
      egressIface({
        a: {
          type: 'ethernet',
          iface: 'enp1s0',
          ipv4: { dhcp: false, addresses: ['10.0.0.2/24'], gateway: '10.0.0.1' },
        },
      }),
    ).toBe('enp1s0')
  })
})

describe('rocky networking', () => {
  test('planEnsureUp describes seed interfaces + egress', () => {
    const lines = planEnsureUp({
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
      interfaces: {
        main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
        vlan2: { type: 'dummy', iface: 'vlan2' },
      },
    })
    expect(lines.some((l) => l.includes('NM apply main'))).toBe(true)
    expect(lines.some((l) => l.includes('skip 1 dummy'))).toBe(true)
    expect(lines.at(-1)).toMatch(/1\.1\.1\.1/)
    expect(rockyNetworking.planEnsureUp).toBe(planEnsureUp)
  })

  test('planApplyDnat helpers', () => {
    const ctx = {
      log: () => {},
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    }
    expect(planApplyDnat(ctx)[0]).toMatch(/DNAT skipped/)
  })

  test('applyInterfaces configures ethernet then vlan; skips dummy', async () => {
    /** @type {string[]} */
    const logs = []
    /** @type {string[][]} */
    const cmds = []
    await applyInterfaces({
      log: (l) => logs.push(l),
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
      interfaces: {
        vlan2: { type: 'dummy', iface: 'vlan2' },
        apps: {
          type: 'vlan',
          iface: 'eth0.2',
          id: 2,
          parent: 'main',
          ipv4: { dhcp: false, addresses: ['10.0.2.10/24'] },
        },
        main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
      },
    })
    expect(cmds[0]).toEqual(['nmcli', 'networking', 'on'])
    expect(cmds.some((c) => c.includes('qctl-eth0') && c.includes('ethernet'))).toBe(true)
    expect(cmds.some((c) => c.includes('qctl-eth0.2') && c.includes('vlan'))).toBe(true)
    expect(cmds.some((c) => c.includes('vlan2'))).toBe(false)
    expect(logs.some((l) => l.includes('main → eth0'))).toBe(true)
  })

  test('ensureUp returns early when ping succeeds after apply', async () => {
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
    expect(logs.some((l) => l.includes('no seed interfaces'))).toBe(true)
    expect(logs.some((l) => /egress OK/.test(l))).toBe(true)
    expect(cmds.filter((c) => c[0] === 'ping')).toEqual([['ping', '-c1', '-W2', '1.1.1.1']])
  })

  test('ensureUp applies interfaces before egress check', async () => {
    /** @type {string[][]} */
    const cmds = []
    await ensureUp({
      log: () => {},
      exec: async (argv) => {
        cmds.push(argv)
        return { code: 0, stdout: '', stderr: '' }
      },
      interfaces: {
        main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
      },
    })
    const nmAdd = cmds.findIndex((c) => c[0] === 'nmcli' && c[1] === 'connection' && c[2] === 'add')
    const ping = cmds.findIndex((c) => c[0] === 'ping')
    expect(nmAdd).toBeGreaterThanOrEqual(0)
    expect(ping).toBeGreaterThan(nmAdd)
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
