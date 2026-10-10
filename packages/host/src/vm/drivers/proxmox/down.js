import { chalk } from 'zx'

import { die } from '../../libs/util.js'
import { clientFrom } from './shared.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function down(argv) {
  if (argv.dryRun) {
    console.log(chalk.dim(`vm: would ACPI shutdown Proxmox VM ${argv.name}`))
    return
  }
  const client = await clientFrom(argv)
  const vmid = await client.findVmidByName(argv.name)
  if (vmid == null) die(`Proxmox VM ${argv.name} not found`)
  const st = await client.qemuStatus(vmid)
  if (st?.status === 'stopped') {
    console.log(chalk.green(`vm: Proxmox VM ${argv.name} already stopped`))
    return
  }
  console.log(chalk.cyan(`vm: Proxmox shutdown ${argv.name} (vmid=${vmid})…`))
  const upid = await client.post(
    `/nodes/${encodeURIComponent(client.config.node)}/qemu/${vmid}/status/shutdown`,
    {},
  )
  if (upid) await client.waitTask(upid, { timeoutSec: argv.timeout || 120 })
  console.log(chalk.green(`vm: Proxmox VM ${argv.name} stopped`))
}
