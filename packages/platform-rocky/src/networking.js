/**
 * Rocky OS networking: NetworkManager egress + firewalld DNAT apply.
 * Guest stages call these via `platform.networking` after dynamic import.
 */
import { existsSync } from 'node:fs'

/** @import { PlatformNetworkCtx, PlatformNetworking } from '@qctl/shared' */

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
  const dnat = ctx.env.QCTL_DNAT_APPLY?.trim() || '/usr/local/lib/rocky/dnat-apply.sh'
  return [`DNAT script: ${dnat}`]
}

/**
 * Run the seed-baked firewalld DNAT helper (if present).
 * @param {PlatformNetworkCtx} ctx
 */
export async function applyDnat(ctx) {
  const dnatApply = ctx.env.QCTL_DNAT_APPLY?.trim() || '/usr/local/lib/rocky/dnat-apply.sh'
  if (!existsSync(dnatApply)) {
    ctx.log(`rocky-services: no ${dnatApply} — skipping DNAT forwards`)
    return
  }
  ctx.log(`rocky-services: applying DNAT forwards from ${dnatApply}`)
  const r = await ctx.exec(['bash', dnatApply])
  if (r.code !== 0) {
    throw new Error(`DNAT apply failed: ${r.stderr.trim()}`)
  }
}

/** @type {PlatformNetworking} */
export const rockyNetworking = {
  planEnsureUp,
  ensureUp,
  planApplyDnat,
  applyDnat,
}
