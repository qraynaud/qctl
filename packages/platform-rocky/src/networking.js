/**
 * Rocky OS networking: NetworkManager from seed interfaces + firewalld DNAT.
 * Guest stages call these via `platform.networking` after dynamic import.
 *
 * L3 shape matches provision / `SeedConfig.networking.interfaces`
 * (`ipv4` / `ipv6` / `nameservers`).
 */
import * as fsp from 'node:fs/promises'

import {
  SEED_IFACE_TYPE,
  applyableInterfaceEntries,
  dnatEntriesFromPorts,
  portsSchema,
  resolveParentIface,
  seedInterfacesSchema,
} from '@qctl/shared'

/**
 * @import {
 *   PlatformNetworkCtx,
 *   PlatformNetworking,
 *   PortsMap,
 *   SeedInterfaceEntry,
 *   SeedInterfaces,
 * } from '@qctl/shared'
 */

const DEFAULT_ROUTE_LOCALNET_CONF = '/etc/sysctl.d/90-rocky-route-localnet.conf'
const EGRESS_HOST = '1.1.1.1'
const EGRESS_IFACE_FALLBACK = 'eth0'
const EGRESS_WAIT_SECS = 120

/**
 * Stable NM connection id for a guest iface.
 * @param {string} iface
 */
export function nmConnectionName(iface) {
  return `qctl-${iface}`
}

/**
 * NM property argv for nested ipv4/ipv6/nameservers (interfaces L3 wire).
 * @param {Pick<SeedInterfaceEntry, 'ipv4' | 'ipv6' | 'nameservers'>} e
 * @returns {string[]}
 */
export function nmL3Args(e) {
  /** @type {string[]} */
  const args = []
  if (e.ipv4) {
    if (e.ipv4.dhcp) {
      args.push('ipv4.method', 'auto')
    } else if (e.ipv4.addresses?.length) {
      args.push('ipv4.method', 'manual', 'ipv4.addresses', e.ipv4.addresses.join(','))
      if (e.ipv4.gateway) args.push('ipv4.gateway', e.ipv4.gateway)
    } else {
      args.push('ipv4.method', 'disabled')
    }
  }
  if (e.ipv6) {
    if (e.ipv6.addresses?.length) {
      args.push('ipv6.method', 'manual', 'ipv6.addresses', e.ipv6.addresses.join(','))
      if (e.ipv6.gateway) args.push('ipv6.gateway', e.ipv6.gateway)
    } else if (e.ipv6['accept-ra']) {
      args.push('ipv6.method', 'auto')
    } else {
      args.push('ipv6.method', 'disabled')
    }
  }
  if (e.nameservers?.length) {
    args.push('ipv4.dns', e.nameservers.join(','))
  }
  return args
}

/**
 * `nmcli connection add …` argv (without leading `nmcli`).
 * @param {string} _label
 * @param {Exclude<SeedInterfaceEntry, { type: 'dummy' }>} e
 * @param {SeedInterfaces} interfaces
 * @returns {string[] | null} null when vlan parent missing
 */
export function nmConnectionAddArgv(_label, e, interfaces) {
  const con = nmConnectionName(e.iface)
  const l3 = nmL3Args(e)
  if (e.type === SEED_IFACE_TYPE.ETHERNET) {
    return ['connection', 'add', 'type', 'ethernet', 'ifname', e.iface, 'con-name', con, ...l3]
  }
  const parent = resolveParentIface(interfaces, e.parent)
  if (!parent) return null
  return [
    'connection',
    'add',
    'type',
    'vlan',
    'con-name',
    con,
    'ifname',
    e.iface,
    'dev',
    parent,
    'id',
    String(e.id),
    ...l3,
  ]
}

/**
 * One-line summary of L3 for plan output.
 * @param {SeedInterfaceEntry} e
 */
function l3PlanHint(e) {
  if (e.ipv4?.dhcp) return 'ipv4.dhcp'
  if (e.ipv4?.addresses?.length) return `ipv4 ${e.ipv4.addresses.join(',')}`
  if (e.ipv6?.addresses?.length) return `ipv6 ${e.ipv6.addresses.join(',')}`
  if (e.ipv6?.['accept-ra']) return 'ipv6.accept-ra'
  return 'no L3'
}

/**
 * Uplink iface for egress wait / dhclient fallback.
 * @param {SeedInterfaces | undefined} interfaces
 */
export function egressIface(interfaces) {
  if (!interfaces) return EGRESS_IFACE_FALLBACK
  const ethers = Object.values(interfaces).filter((e) => e.type === SEED_IFACE_TYPE.ETHERNET)
  const dhcp = ethers.find((e) => e.ipv4?.dhcp)
  if (dhcp) return dhcp.iface
  const gw = ethers.find((e) => e.ipv4?.gateway || e.ipv6?.gateway)
  if (gw) return gw.iface
  if (ethers[0]) return ethers[0].iface
  return EGRESS_IFACE_FALLBACK
}

/**
 * @param {SeedInterfaces | undefined} interfaces
 * @param {string} iface
 */
function ifaceWantsDhcp(interfaces, iface) {
  if (!interfaces) return true
  for (const e of Object.values(interfaces)) {
    if (e.iface === iface && e.ipv4?.dhcp) return true
  }
  return false
}

/**
 * @param {PlatformNetworkCtx} ctx
 * @returns {SeedInterfaces | null}
 */
function resolveInterfaces(ctx) {
  if (!ctx.interfaces) return null
  return seedInterfacesSchema.parse(ctx.interfaces)
}

/**
 * Apply ethernet + vlan from seed via NetworkManager (skip dummy).
 * @param {PlatformNetworkCtx} ctx
 */
export async function applyInterfaces(ctx) {
  const interfaces = resolveInterfaces(ctx)
  if (!interfaces || !Object.keys(interfaces).length) {
    ctx.log('rocky-network: no seed interfaces — skip NM apply')
    return
  }

  const entries = applyableInterfaceEntries(interfaces)
  if (!entries.length) {
    ctx.log('rocky-network: seed interfaces are dummy-only — skip NM apply')
    return
  }

  ctx.log(`rocky-network: applying ${entries.length} interface(s) via NetworkManager`)
  await ctx.exec(['nmcli', 'networking', 'on'])

  for (const [label, e] of entries) {
    const addArgv = nmConnectionAddArgv(label, e, interfaces)
    if (!addArgv) {
      const parent = e.type === SEED_IFACE_TYPE.VLAN ? e.parent : '?'
      ctx.log(`rocky-network: WARN: vlan ${label} missing ethernet parent ${parent} — skip`)
      continue
    }
    const con = nmConnectionName(e.iface)
    await ctx.exec(['nmcli', 'connection', 'delete', 'id', con])
    const add = await ctx.exec(['nmcli', ...addArgv])
    if (add.code !== 0) {
      throw new Error(
        `nmcli add ${con} failed: ${add.stderr.trim() || add.stdout.trim() || `exit ${add.code}`}`,
      )
    }
    const up = await ctx.exec(['nmcli', 'connection', 'up', con])
    if (up.code !== 0) {
      throw new Error(
        `nmcli up ${con} failed: ${up.stderr.trim() || up.stdout.trim() || `exit ${up.code}`}`,
      )
    }
    ctx.log(`rocky-network: ${label} → ${e.iface} (${e.type}, ${l3PlanHint(e)})`)
  }
}

/**
 * @param {PlatformNetworkCtx} ctx
 * @returns {string[]}
 */
export function planEnsureUp(ctx) {
  const lines = []
  if (ctx.interfaces && Object.keys(ctx.interfaces).length) {
    const parsed = seedInterfacesSchema.parse(ctx.interfaces)
    for (const [label, e] of applyableInterfaceEntries(parsed)) {
      if (e.type === SEED_IFACE_TYPE.VLAN) {
        lines.push(
          `NM apply ${label}: vlan ${e.iface} id ${e.id} parent=${e.parent} (${l3PlanHint(e)})`,
        )
      } else {
        lines.push(`NM apply ${label}: ethernet ${e.iface} (${l3PlanHint(e)})`)
      }
    }
    const dummies = Object.entries(parsed).filter(([, e]) => e.type === SEED_IFACE_TYPE.DUMMY)
    if (dummies.length) {
      lines.push(`skip ${dummies.length} dummy iface(s) (ensure-dummies stage)`)
    }
  } else {
    lines.push('no seed interfaces — egress fallback only')
  }
  lines.push(
    `ping ${EGRESS_HOST}; on miss: nmcli/dhclient ${egressIface(ctx.interfaces)}, wait up to ${EGRESS_WAIT_SECS}s`,
  )
  return lines
}

/**
 * Apply seed interfaces, then re-check egress (bring up uplink if needed).
 * Never throws on egress timeout — later stages that need the network fail more clearly.
 * @param {PlatformNetworkCtx} ctx
 */
export async function ensureUp(ctx) {
  await applyInterfaces(ctx)

  /**
   * @returns {Promise<boolean>}
   */
  async function egressOk() {
    const r = await ctx.exec(['ping', '-c1', '-W2', EGRESS_HOST])
    return r.code === 0
  }

  if (await egressOk()) {
    ctx.log(`rocky-network: egress OK (${EGRESS_HOST})`)
    return
  }

  const iface = egressIface(ctx.interfaces)
  ctx.log(`rocky-network: no egress to ${EGRESS_HOST} — bringing up ${iface}`)
  await ctx.exec(['nmcli', 'networking', 'on'])
  await ctx.exec(['nmcli', 'device', 'connect', iface])
  if (ifaceWantsDhcp(ctx.interfaces, iface)) {
    await ctx.exec(['dhclient', '-1', iface])
  }

  const tries = Math.max(1, Math.floor(EGRESS_WAIT_SECS / 2))
  for (let i = 0; i < tries; i++) {
    if (await egressOk()) {
      ctx.log(`rocky-network: egress OK (${EGRESS_HOST})`)
      return
    }
    await Bun.sleep(2000)
  }
  ctx.log(
    `rocky-network: WARN: no egress to ${EGRESS_HOST} after ${EGRESS_WAIT_SECS}s (continuing)`,
  )
}

/**
 * Ports come only from ISO seed (`ctx.ports`).
 * @param {PlatformNetworkCtx} ctx
 * @returns {{ ports: PortsMap, source: string } | null}
 */
function resolvePortsMap(ctx) {
  if (!ctx.ports) return null
  return { ports: portsSchema.parse(ctx.ports), source: 'seed config' }
}

/**
 * @param {PlatformNetworkCtx} ctx
 * @returns {string[]}
 */
export function planApplyDnat(ctx) {
  if (ctx.ports) {
    return ['DNAT from seed config ports (firewalld → 127.0.0.1)']
  }
  return ['DNAT skipped (no seed ports)']
}

/**
 * Apply firewalld DNAT forwards from seed ports (entries with `dnat`).
 * @param {PlatformNetworkCtx} ctx
 */
export async function applyDnat(ctx) {
  const resolved = resolvePortsMap(ctx)
  if (!resolved) {
    ctx.log('rocky-services: no seed ports — skipping DNAT forwards')
    return
  }
  const { ports, source } = resolved

  const dnats = dnatEntriesFromPorts(ports)
  if (!dnats.length) {
    ctx.log(`rocky-services: no ports with dnat in ${source} — skipping`)
    return
  }

  ctx.log(`rocky-services: applying ${dnats.length} DNAT forward(s) from ${source} → 127.0.0.1`)

  const routeLocalnet = ctx.routeLocalnetConf?.trim() || DEFAULT_ROUTE_LOCALNET_CONF
  await fsp.writeFile(
    routeLocalnet,
    [
      '# Rocky: firewalld DNAT → 127.0.0.1 (rootless PublishPort); from seed ports',
      'net.ipv4.conf.all.route_localnet=1',
      'net.ipv4.conf.default.route_localnet=1',
      '',
    ].join('\n'),
  )
  const sysctl = await ctx.exec(['sysctl', '-p', routeLocalnet])
  if (sysctl.code !== 0) {
    throw new Error(`DNAT sysctl failed: ${sysctl.stderr.trim()}`)
  }

  for (const { name, port, dnat } of dnats) {
    const bare = `port=${port}:proto=tcp:toport=${dnat}`
    const withAddr = `${bare}:toaddr=127.0.0.1`
    await ctx.exec(['firewall-cmd', '--permanent', `--remove-forward-port=${bare}`])
    await ctx.exec(['firewall-cmd', '--permanent', `--remove-forward-port=${withAddr}`])
    const add = await ctx.exec(['firewall-cmd', '--permanent', `--add-forward-port=${withAddr}`])
    if (add.code !== 0) {
      throw new Error(`DNAT add ${name} (${port}→${dnat}) failed: ${add.stderr.trim()}`)
    }
  }
}

/** @type {PlatformNetworking} */
export const rockyNetworking = {
  planEnsureUp,
  ensureUp,
  planApplyDnat,
  applyDnat,
}
