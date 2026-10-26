/** Local (libvirt) shell / console hints for status / ssh-info snapshots. */
import { which } from '../../lib/util.js'
import { virsh } from './libvirt/index.js'

/** @import { VmStatusSnapshot } from '../driver-contract.js' */
/** @import { PortsMap } from '../types.js' */

/**
 * @param {{
 *   connect: string,
 *   name: string,
 *   ports: PortsMap,
 *   network?: string,
 * }} opts
 * @returns {Promise<NonNullable<VmStatusSnapshot['hints']>>}
 */
export async function localSshHints({ connect, name, ports, network }) {
  /** @type {string[]} */
  const lines = ['qctl vm shell']
  const useUserNet = network !== 'default'
  const cockpit = ports.cockpit

  if (useUserNet && cockpit?.forward != null) {
    lines.push(`cockpit: https://127.0.0.1:${cockpit.forward}/  (passt → guest :${cockpit.port})`)
  }

  if (await which('virsh')) {
    if (!useUserNet) {
      const lease = await virsh(connect, 'domifaddr', name, '--source', 'lease').nothrow()
      if (lease.exitCode === 0 && String(lease.stdout).trim()) {
        lines.push(String(lease.stdout).trim())
        lines.push('(default net: vm shell uses the guest DHCP lease)')
      } else {
        lines.push(
          `(no DHCP lease yet — wait for boot, then: virsh -c ${connect} domifaddr ${name} --source lease)`,
        )
        lines.push('hint: if stuck on link-local only, set ethernet.vm mode: nat (passt hostfwd)')
      }
    }
    lines.push(`console: virsh -c ${connect} console ${name}`)
  }

  lines.push('impersonate apps: sudo systemctl start user@900.service')
  lines.push('               then: sudo runuser -u apps -- …')

  return { title: 'Shell', lines }
}

/**
 * @deprecated Prefer {@link localSshHints} + CLI print; kept for any leftover callers.
 * @param {{
 *   connect: string,
 *   name: string,
 *   ports: PortsMap,
 *   network?: string,
 * }} opts
 * @returns {Promise<void>}
 */
export async function printLocalSshInfo(opts) {
  const { chalk } = await import('zx')
  const hints = await localSshHints(opts)
  console.log(chalk.cyan(`\n${hints.title || 'Shell'}`))
  for (const line of hints.lines) {
    if (line.startsWith('cockpit:')) {
      console.log(chalk.cyan('\nCockpit'))
      console.log(`  ${line.replace(/^cockpit:\s*/, '')}`)
      continue
    }
    if (line.startsWith('hint:')) {
      console.log(chalk.yellow(`  ${line}`))
      continue
    }
    console.log(chalk.dim(`  ${line}`))
  }
}
