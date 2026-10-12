import { chalk, fs } from 'zx'

import { portsFromArgv } from '../../../lib/options.js'
import { DATA_COUNT, SPECIAL_COUNT } from '../../../lib/paths.js'
import { requireBins } from '../../../lib/util.js'
import { vmPaths } from '../../libs/disks.js'
import { virsh } from '../../libs/libvirt.js'
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
    const p = vmPaths(name)
    console.log(`  os: ${fs.existsSync(p.os) ? p.os : '(missing)'}`)
    console.log(`  vw: ${fs.existsSync(p.vw) ? p.vw : '(missing)'}`)
    for (let i = 0; i < DATA_COUNT; i++) {
      console.log(`  data${i}: ${fs.existsSync(p.data[i]) ? p.data[i] : '(missing)'}`)
    }
    for (let i = 0; i < SPECIAL_COUNT; i++) {
      console.log(`  special${i}: ${fs.existsSync(p.special[i]) ? p.special[i] : '(missing)'}`)
    }
    return
  }
  console.log(String(r.stdout).trim())
  await printLocalSshInfo({
    connect,
    name,
    ports: portsFromArgv(argv),
    argv,
    network: argv.network === 'auto' ? 'user' : argv.network,
  })
}
