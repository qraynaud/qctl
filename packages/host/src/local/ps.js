import { chalk } from 'zx'

import { applianceExists, applianceRunning } from './appliance.js'
import { createLocalContext } from './context.js'
import { execInAppliance } from './exec-in.js'
import { sharedLocalEnv } from './options.js'
import { argvApps, log } from './util.js'

/** @import { Argv } from 'yargs' */

export const command = 'ps [apps..]'
export const describe = 'Appliance status and quadlet ps'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLocalEnv(yargs)
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Limit quadlet ps to these apps',
    })
    .strict()
}

/**
 * @typedef {object} LocalPsArgv
 * @property {string} [env]
 * @property {string | string[]} [apps]
 */

/**
 * @param {string} s
 * @returns {string}
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * @param {LocalPsArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const ctx = await createLocalContext(argv)
  const exists = await applianceExists(ctx)
  const running = exists && (await applianceRunning(ctx))
  console.log(chalk.cyan('local ps'), chalk.dim(`name=${ctx.name} env=${ctx.env}`))
  console.log(
    `  appliance: ${running ? chalk.green('running') : exists ? chalk.yellow('stopped') : chalk.dim('absent')}`,
  )
  if (!running) {
    log('start with `qctl local up`')
    return
  }
  const apps = argvApps(argv)
  const r = await execInAppliance(
    ctx,
    apps.length
      ? `cd /tank/rocky && qctl quadlet ps ${apps.map(shellQuote).join(' ')}`
      : 'cd /tank/rocky && qctl quadlet ps',
    { nothrow: true },
  )
  console.log(String(r.stdout).trimEnd() || chalk.dim('(no quadlet output)'))
  if (r.exitCode !== 0 && r.stderr) {
    console.error(String(r.stderr).trimEnd())
  }
}
