/**
 * Rocky OS networking: NetworkManager egress + firewalld DNAT from ports.json.
 * Guest stages call these via `platform.networking` after dynamic import.
 */
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'

import { dnatEntriesFromPorts, portsSchema } from '@qctl/shared'

/** @import { PlatformNetworkCtx, PlatformNetworking, PortsMap } from '@qctl/shared' */

const DEFAULT_PORTS_JSON = '/usr/local/lib/rocky/ports.json'
const DEFAULT_ROUTE_LOCALNET_CONF = '/etc/sysctl.d/90-rocky-route-localnet.conf'

/**
 * @param {PlatformNetworkCtx} ctx
 * @returns {string[]}
 */
export function planEnsureUp(ctx) {
  const host = ctx.env.QCTL_EGRESS_HOST?.trim() || '1.1.1.1'
  const iface = ctx.env.QCTL_EGRESS_IFACE?.trim() || 'eth0'
  const wait = ctx.env.QCTL_EGRESS_WAIT_SECS?.trim() || '120'
  return [`ping ${host}; on miss: nmcli/dhclient ${iface}, wait up to ${wait}s`]
}

/**
 * Re-check egress; bring up the uplink with NetworkManager if needed.
 * Never throws — later stages that need the network fail more clearly.
 * @param {PlatformNetworkCtx} ctx
 */
export async function ensureUp(ctx) {
  const host = ctx.env.QCTL_EGRESS_HOST?.trim() || '1.1.1.1'
  const waitSecs = Math.max(1, Number(ctx.env.QCTL_EGRESS_WAIT_SECS || 120) || 120)
  const iface = ctx.env.QCTL_EGRESS_IFACE?.trim() || 'eth0'

  /**
   * @returns {Promise<boolean>}
   */
  async function egressOk() {
    const r = await ctx.exec(['ping', '-c1', '-W2', host])
    return r.code === 0
  }

  if (await egressOk()) {
    ctx.log(`rocky-network: egress OK (${host})`)
    return
  }

  ctx.log(`rocky-network: no egress to ${host} — bringing up ${iface}`)
  await ctx.exec(['nmcli', 'networking', 'on'])
  await ctx.exec(['nmcli', 'device', 'connect', iface])
  await ctx.exec(['dhclient', '-1', iface])

  const tries = Math.max(1, Math.floor(waitSecs / 2))
  for (let i = 0; i < tries; i++) {
    if (await egressOk()) {
      ctx.log(`rocky-network: egress OK (${host})`)
      return
    }
    await Bun.sleep(2000)
  }
  ctx.log(`rocky-network: WARN: no egress to ${host} after ${waitSecs}s (continuing)`)
}

/**
 * @param {PlatformNetworkCtx} ctx
 * @returns {string[]}
 */
export function planApplyDnat(ctx) {
  const portsJson = ctx.env.QCTL_PORTS_JSON?.trim() || DEFAULT_PORTS_JSON
  return [`DNAT from ${portsJson} (firewalld → 127.0.0.1)`]
}

/**
 * Apply firewalld DNAT forwards from seed-injected `ports.json` (entries with `dnat`).
 * @param {PlatformNetworkCtx} ctx
 */
export async function applyDnat(ctx) {
  const portsJson = ctx.env.QCTL_PORTS_JSON?.trim() || DEFAULT_PORTS_JSON
  if (!fs.existsSync(portsJson)) {
    ctx.log(`rocky-services: no ${portsJson} — skipping DNAT forwards`)
    return
  }

  /** @type {PortsMap} */
  let ports
  try {
    ports = portsSchema.parse(JSON.parse(await fsp.readFile(portsJson, 'utf8')))
  } catch (err) {
    throw new Error(
      `DNAT: failed to read ${portsJson}: ${err instanceof Error ? err.message : err}`,
    )
  }

  const dnats = dnatEntriesFromPorts(ports)
  if (!dnats.length) {
    ctx.log(`rocky-services: no ports with dnat in ${portsJson} — skipping`)
    return
  }

  ctx.log(`rocky-services: applying ${dnats.length} DNAT forward(s) from ${portsJson} → 127.0.0.1`)

  const routeLocalnet = ctx.env.QCTL_ROUTE_LOCALNET_CONF?.trim() || DEFAULT_ROUTE_LOCALNET_CONF
  await fsp.writeFile(
    routeLocalnet,
    [
      '# Rocky: firewalld DNAT → 127.0.0.1 (rootless PublishPort); from ports.json',
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
    // Best-effort remove of prior rules (missing → non-zero; ignore).
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
