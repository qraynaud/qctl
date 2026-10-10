import { chalk } from 'zx'

import { clientFrom } from './shared.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function status(argv) {
  if (argv.dryRun) {
    console.log(chalk.dim(`vm: would query Proxmox VM name=${argv.name}`))
    return
  }
  const client = await clientFrom(argv)
  const vmid = await client.findVmidByName(argv.name)
  if (vmid == null) {
    console.log(chalk.yellow(`vm: Proxmox VM ${argv.name} not found on node ${client.config.node}`))
    return
  }
  const st = await client.qemuStatus(vmid)
  console.log(chalk.cyan(`vm: Proxmox ${argv.name} vmid=${vmid}`))
  console.log(`  status: ${st?.status || '?'}`)
  if (st?.uptime != null) console.log(`  uptime: ${st.uptime}s`)
  if (st?.cpus != null) console.log(`  cpus: ${st.cpus}`)
  if (st?.maxmem) console.log(`  maxmem: ${Math.round(st.maxmem / 1024 / 1024)} MiB`)
}
