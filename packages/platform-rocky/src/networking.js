/**
 * Rocky OS networking: NetworkManager egress + firewalld DNAT from seed ports.
 * Guest stages call these via `platform.networking` after dynamic import.
 */
import * as fsp from 'node:fs/promises'

import { dnatEntriesFromPorts, portsSchema } from '@qctl/shared'

/** @import { PlatformNetworkCtx, PlatformNetworking, PortsMap } from '@qctl/shared' */

const DEFAULT_ROUTE_LOCALNET_CONF = '/etc/sysctl.d/90-rocky-route-localnet.conf'
const EGRESS_HOST = '1.1.1.1'
const EGRESS_IFACE = 'eth0'
const EGRESS_WAIT_SECS = 120

/**
 * @param {PlatformNetworkCtx} _ctx
 * @returns {string[]}
 */
export function planEnsureUp(_ctx) {
  return [
    `ping ${EGRESS_HOST}; on miss: nmcli/dhclient ${EGRESS_IFACE}, wait up to ${EGRESS_WAIT_SECS}s`,
  ]
}

/**
 * Re-check egress; bring up the uplink with NetworkManager if needed.
 * Never throws — later stages that need the network fail more clearly.
 * @param {PlatformNetworkCtx} ctx
 */
export async function ensureUp(ctx) {
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

  ctx.log(`rocky-network: no egress to ${EGRESS_HOST} — bringing up ${EGRESS_IFACE}`)
  await ctx.exec(['nmcli', 'networking', 'on'])
  await ctx.exec(['nmcli', 'device', 'connect', EGRESS_IFACE])
  await ctx.exec(['dhclient', '-1', EGRESS_IFACE])

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
