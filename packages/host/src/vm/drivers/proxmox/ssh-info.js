import { chalk } from 'zx'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function sshInfo(argv) {
  console.log(chalk.cyan('\nShell (Proxmox)'))
  console.log(chalk.dim('  qctl vm shell --host <guest-ip>'))
  console.log(chalk.dim('  (guest IP from PVE / DHCP — no local passt :2222 by default)'))
  console.log(chalk.dim(`  console: streamed by up/init-tank (or PVE → ${argv.name} → Console)`))
}
