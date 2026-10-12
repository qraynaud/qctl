/** Local (libvirt) SSH / console hints. */
import { chalk } from 'zx'

import { portByName, resolvePorts } from '../../lib/ports.js'
import { which } from '../../lib/util.js'
import { virsh } from './libvirt/index.js'

/** @import { PortEntry, VmArgv } from '../types.js' */

const ADMIN_HINT = 'rocky' // or VW Login rocky username when that Login has credentials

/**
 * @param {{
 *   connect: string,
 *   name: string,
 *   ports: PortEntry[],
 *   argv?: Partial<VmArgv>,
 *   network?: string,
 * }} opts
 * @returns {Promise<void>}
 */
export async function printLocalSshInfo({ connect, name, ports, argv = {}, network }) {
  const resolved = resolvePorts(ports, argv)
  const ssh = portByName(resolved, 'ssh')
  const cockpit = portByName(resolved, 'cockpit')
  const http = portByName(resolved, 'http')
  const https = portByName(resolved, 'https')

  console.log(chalk.cyan('\nSSH'))
  console.log(chalk.dim(`  user = rocky (default) or VW Login rocky username; root SSH disabled`))
  const useUserNet = network !== 'default'
  if (useUserNet) {
    if (ssh?.forward != null) {
      console.log(`  ssh -p ${ssh.forward} ${ADMIN_HINT}@127.0.0.1`)
    }
    if (cockpit?.forward != null) {
      console.log(chalk.cyan('\nCockpit'))
      console.log(`  https://127.0.0.1:${cockpit.forward}/  (passt → guest :${cockpit.port})`)
    }
    if (https?.forward != null || http?.forward != null) {
      console.log(chalk.cyan('\nCaddy'))
      if (https?.forward != null) {
        const via = https.dnat != null ? ` → DNAT 127.0.0.1:${https.dnat}` : ''
        console.log(`  https://127.0.0.1:${https.forward}/  (passt → guest :${https.port}${via})`)
        console.log(
          chalk.dim(
            `  example: curl -skI --resolve vw.lsystems.localhost:${https.forward}:127.0.0.1 `
              + `https://vw.lsystems.localhost:${https.forward}/`,
          ),
        )
      }
      if (http?.forward != null) {
        const via = http.dnat != null ? ` → DNAT 127.0.0.1:${http.dnat}` : ''
        console.log(
          chalk.dim(`  http  http://127.0.0.1:${http.forward}/  → guest :${http.port}${via}`),
        )
      }
    }
  }
  if (!(await which('virsh'))) return

  if (!useUserNet) {
    const lease = await virsh(connect, 'domifaddr', name, '--source', 'lease').nothrow()
    if (lease.exitCode === 0 && String(lease.stdout).trim()) {
      console.log(chalk.dim(String(lease.stdout).trim()))
      const m = String(lease.stdout).match(/(\d+\.\d+\.\d+\.\d+)/)
      if (m) console.log(`  ssh ${ADMIN_HINT}@${m[1]}`)
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
