/** Local (libvirt) shell / console hints after `vm up` / `status` / `ssh-info`. */
import { chalk } from 'zx'

import { which } from '../../lib/util.js'
import { virsh } from './libvirt/index.js'

/** @import { PortsMap } from '../types.js' */

/**
 * @param {{
 *   connect: string,
 *   name: string,
 *   ports: PortsMap,
 *   network?: string,
 * }} opts
 * @returns {Promise<void>}
 */
export async function printLocalSshInfo({ connect, name, ports, network }) {
  const cockpit = ports.cockpit

  console.log(chalk.cyan('\nShell'))
  console.log(chalk.dim('  qctl vm shell'))
  const useUserNet = network !== 'default'
  if (useUserNet) {
    if (cockpit?.forward != null) {
      console.log(chalk.cyan('\nCockpit'))
      console.log(`  https://127.0.0.1:${cockpit.forward}/  (passt → guest :${cockpit.port})`)
    }
  }
  if (!(await which('virsh'))) return

  if (!useUserNet) {
    const lease = await virsh(connect, 'domifaddr', name, '--source', 'lease').nothrow()
    if (lease.exitCode === 0 && String(lease.stdout).trim()) {
      console.log(chalk.dim(String(lease.stdout).trim()))
      console.log(chalk.dim('  (default net: vm shell uses the guest DHCP lease)'))
    } else {
      console.log(
        chalk.dim(
          `  (no DHCP lease yet — wait for boot, then: virsh -c ${connect} domifaddr ${name} --source lease)`,
        ),
      )
      console.log(
        chalk.yellow(
          `  hint: if stuck on link-local only, retry with --network user (passt hostfwd)`,
        ),
      )
    }
  }
  console.log(chalk.dim(`  console: virsh -c ${connect} console ${name}`))
  console.log(chalk.dim('  impersonate apps: sudo systemctl start user@900.service'))
  console.log(chalk.dim('                 then: sudo runuser -u apps -- …'))
}
