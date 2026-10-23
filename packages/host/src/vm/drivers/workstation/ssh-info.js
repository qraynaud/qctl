import { portsFromArgv } from '../../../lib/options.js'
import { requireBins } from '../../../lib/util.js'
import { printLocalSshInfo } from '../../libs/ssh-hints.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function sshInfo(argv) {
  await requireBins(['virsh'])
  await printLocalSshInfo({
    connect: argv.connect,
    name: argv.name,
    ports: portsFromArgv(argv),
    network: argv.network === 'auto' ? 'user' : argv.network,
  })
}
