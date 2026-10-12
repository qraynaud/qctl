import { chalk, fs } from 'zx'

import { DATA_COUNT, SPECIAL_COUNT } from '../../../lib/paths.js'
import { requireBins } from '../../../lib/util.js'
import { persistentDisks, vmPaths } from '../../libs/disks.js'
import { domainExists, removeDomain } from '../../libs/libvirt.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {Pick<VmArgv, 'connect' | 'name' | 'keepData' | 'dryRun'>} opts
 * @returns {Promise<void>}
 */
export async function destroyVm({ connect, name, keepData, dryRun }) {
  const p = vmPaths(name)
  if (dryRun) {
    console.log(chalk.dim(`vm: would destroy domain ${name} (keepData=${keepData})`))
    return
  }
  await requireBins(['virsh'])

  if (await domainExists(connect, name)) {
    await removeDomain(connect, name)
  } else {
    console.log(chalk.dim(`vm: domain ${name} not defined`))
  }

  if (!keepData) {
    for (const f of [p.os, ...persistentDisks(p)]) {
      if (fs.existsSync(f)) {
        console.log(chalk.yellow(`vm: remove ${f}`))
        await fs.remove(f)
      }
    }
  } else {
    if (fs.existsSync(p.os)) {
      console.log(chalk.yellow(`vm: remove OS only ${p.os} (--keep-data)`))
      await fs.remove(p.os)
    }
    console.log(
      chalk.green(`vm: kept /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT} under ${p.dir}`),
    )
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function destroy(argv) {
  await destroyVm({
    connect: argv.connect,
    name: argv.name,
    keepData: argv.keepData,
    dryRun: argv.dryRun,
  })
}
