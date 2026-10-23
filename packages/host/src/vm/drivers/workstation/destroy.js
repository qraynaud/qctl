import { chalk, fs } from 'zx'

import { requireBins } from '../../../lib/util.js'
import { persistentDisks, vmPaths } from '../../libs/disks.js'
import { domainExists, removeDomain } from '../../libs/libvirt/index.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {Pick<VmArgv, 'connect' | 'name' | 'keepPersistent' | 'dryRun' | 'env' | 'target'>} opts
 * @returns {Promise<void>}
 */
export async function destroyVm({ connect, name, keepPersistent, dryRun, env, target }) {
  const resolved = await resolveProvisionDisks({
    env: env || 'dev',
    target: target || 'workstation',
  })
  const p = vmPaths(name, resolved)
  if (dryRun) {
    console.log(
      chalk.dim(`vm: would destroy domain ${name} (keepPersistent=${Boolean(keepPersistent)})`),
    )
    return
  }
  await requireBins(['virsh'])

  if (await domainExists(connect, name)) {
    await removeDomain(connect, name)
  } else {
    console.log(chalk.dim(`vm: domain ${name} not defined`))
  }

  if (!keepPersistent) {
    for (const f of [p.os.path, ...persistentDisks(p)]) {
      if (fs.existsSync(f)) {
        console.log(chalk.yellow(`vm: remove ${f}`))
        await fs.remove(f)
      }
    }
  } else {
    if (fs.existsSync(p.os.path) && p.os.path.endsWith('.qcow2')) {
      console.log(chalk.yellow(`vm: remove OS only ${p.os.path} (--keep-persistent)`))
      await fs.remove(p.os.path)
    }
    console.log(chalk.green(`vm: kept ${p.attached.length} persistent disk(s) under ${p.dir}`))
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
    keepPersistent: argv.keepPersistent,
    dryRun: argv.dryRun,
    env: argv.env,
    target: argv.target,
  })
}
