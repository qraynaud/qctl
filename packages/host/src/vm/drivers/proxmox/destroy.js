import { chalk } from 'zx'

import { clearInstalled } from '../../libs/installed-lifecycle.js'
import { destroyHolder } from '../../libs/proxmox/disk-holder.js'
import { createFlagStore } from '../../libs/proxmox/flag-store.js'
import { destroyRockyVm } from '../../libs/proxmox/vm.js'
import { clientFrom } from './shared.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function destroy(argv) {
  if (argv.dryRun) {
    console.log(
      chalk.dim(
        `vm: would destroy Proxmox VM ${argv.name}`
          + (argv.keepPersistent
            ? ' (keep-persistent → demote to holder)'
            : ' + holder <name>-disks (full wipe)'),
      ),
    )
    return
  }
  const client = await clientFrom(argv)
  const vmid = await client.findVmidByName(argv.name)
  if (vmid != null) {
    // Drop INSTALLED while the VM still exists (tags live on the qemu config).
    await clearInstalled(createFlagStore(client, vmid))
    await destroyRockyVm(client, {
      vmid,
      name: argv.name,
      keep: argv.keepPersistent ? 'persistent' : 'none',
    })
  } else {
    console.log(chalk.dim(`vm: Proxmox VM ${argv.name} not defined`))
    // Still wipe holder on full destroy (e.g. after init-tank only).
    if (!argv.keepPersistent) await destroyHolder(client, argv.name)
  }
}
