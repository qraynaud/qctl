import { chalk } from 'zx'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function sshInfo(argv) {
  console.log(chalk.cyan('\nSSH (Proxmox)'))
  console.log(chalk.dim('  Use guest IP from PVE / DHCP (no local passt :2222 by default)'))
  console.log(chalk.dim(`  console: streamed by up/init-tank (or PVE → ${argv.name} → Console)`))
}
