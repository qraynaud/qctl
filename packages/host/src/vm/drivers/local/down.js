import { chalk } from 'zx'

import { die, requireBins } from '../../../lib/util.js'
import { domainExists, domainState, setDomainSerialNull, virsh } from '../../libs/libvirt.js'
import { sleep } from '../../libs/wait.js'

/** @import { VmArgv } from '../../types.js' */

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function down(argv) {
  const { connect, name, dryRun, timeout, force } = argv

  if (dryRun) {
    console.log(chalk.dim(`vm: would shut down ${name} (wait ≤${timeout}s)`))
    return
  }
  await requireBins(['virsh'])
  if (!(await domainExists(connect, name))) die(`domain ${name} not found`)

  const state = await domainState(connect, name)
  if (state === 'shut off') {
    await setDomainSerialNull(connect, name)
    console.log(chalk.green(`vm: domain ${name} already shut off`))
    return
  }

  if (state === 'running' || state === 'paused') {
    await virsh(connect, 'shutdown', name)
    console.log(chalk.cyan(`vm: ACPI shutdown requested for ${name}`))
  } else if (state !== 'in shutdown') {
    die(`domain ${name} in unexpected state: ${state}`)
  }

  const deadline = Date.now() + timeout * 1000
  while (Date.now() < deadline) {
    const s = await domainState(connect, name)
    if (s === 'shut off') {
      await setDomainSerialNull(connect, name)
      console.log(chalk.green(`vm: domain ${name} shut off`))
      return
    }
    await sleep(2000)
  }

  if (force) {
    console.log(chalk.yellow(`vm: still running after ${timeout}s — virsh destroy`))
    await virsh(connect, 'destroy', name)
    await setDomainSerialNull(connect, name)
    console.log(chalk.green(`vm: domain ${name} destroyed (forced poweroff)`))
    return
  }

  die(
    `domain ${name} still ${await domainState(connect, name)} after ${timeout}s — `
      + `retry down --force, or check guest ACPI`,
  )
}
