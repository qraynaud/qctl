import { powerState } from './ops.js'
import { clientFrom } from './shared.js'

/** @import { VmContext, VmStatusSnapshot } from '../../driver-contract.js' */

/**
 * Gather Proxmox status + shell hints (no printing).
 * @param {VmContext} ctx
 * @returns {Promise<VmStatusSnapshot>}
 */
export async function getStatus(ctx) {
  const name = String(ctx.name).trim()
  const power = await powerState(ctx)
  /** @type {VmStatusSnapshot} */
  const snap = {
    power,
    hints: {
      title: 'Shell (Proxmox)',
      lines: [
        'qctl vm shell --host <guest-ip>',
        '(guest IP from PVE / DHCP — no local passt :2222 by default)',
        `console: streamed by up/init-tank (or PVE → ${name} → Console)`,
      ],
    },
  }

  if (ctx.dryRun) {
    snap.summary = `would query Proxmox VM name=${name}`
    return snap
  }

  const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
  const vmid = await client.findVmidByName(name)
  if (vmid == null) {
    snap.summary = `Proxmox VM ${name} not found on node ${client.config.node}`
    return snap
  }

  const st = await client.qemuStatus(vmid)
  snap.summary = `Proxmox ${name} vmid=${vmid}`
  /** @type {Record<string, string | number | null | undefined>} */
  const fields = { status: st?.status || '?' }
  if (st?.uptime != null) fields.uptime = `${st.uptime}s`
  if (st?.cpus != null) fields.cpus = st.cpus
  if (st?.maxmem) fields.maxmem = `${Math.round(st.maxmem / 1024 / 1024)} MiB`
  snap.fields = fields
  return snap
}
