import { chalk, fs } from 'zx'

import { portsFromArgv } from '../../../lib/options.js'
import { requireBins } from '../../../lib/util.js'
import { vmPaths } from '../../libs/disks.js'
import { virsh } from '../../libs/libvirt/index.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { printLocalSshInfo } from '../../libs/ssh-hints.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function status(argv) {
  const { connect, name } = argv

  await requireBins(['virsh'])
  const r = await virsh(connect, 'dominfo', name).nothrow()
  if (r.exitCode !== 0) {
    console.log(chalk.yellow(`vm: domain ${name} not defined`))
    try {
      const resolved = await resolveProvisionDisks({
        env: argv.env || 'dev',
        target: argv.target || 'workstation',
      })
      const p = vmPaths(name, resolved)
      console.log(`  os: ${fs.existsSync(p.os.path) ? p.os.path : '(missing)'}`)
      for (const e of p.attached) {
        console.log(`  ${e.id}: ${fs.existsSync(e.path) ? e.path : '(missing)'}`)
      }
    } catch (err) {
      console.log(
        chalk.dim(`  (could not resolve disks: ${err instanceof Error ? err.message : err})`),
      )
    }
    return
  }
  console.log(String(r.stdout).trim())
  await printLocalSshInfo({
    connect,
    name,
    ports: portsFromArgv(argv),
    network: argv.network === 'auto' ? 'user' : argv.network,
  })
}
