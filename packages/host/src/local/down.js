import {
  anyQuadletUp,
  applianceExists,
  applianceRunning,
  quadletDown,
  removeAppliance,
} from './appliance.js'
import { listInstanceApps } from './apps.js'
import { createLocalContext } from './context.js'
import { sharedLocalEnv } from './options.js'
import { argvApps, log } from './util.js'

/** @import { Argv } from 'yargs' */

export const command = 'down [apps..]'
export const describe = 'Stop apps (or all); remove the appliance when nothing is left running'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLocalEnv(yargs)
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Apps to stop (omit = all)',
    })
    .strict()
}

/**
 * @typedef {object} LocalDownArgv
 * @property {string} [env]
 * @property {string | string[]} [apps]
 */

/**
 * @param {LocalDownArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const ctx = await createLocalContext(argv)
  if (!(await applianceExists(ctx))) {
    log('no appliance container')
    return
  }
  if (!(await applianceRunning(ctx))) {
    await removeAppliance(ctx)
    return
  }

  const apps = argvApps(argv)
  if (apps.length) {
    await quadletDown(ctx, apps)
  } else {
    const all = listInstanceApps(ctx.root)
    if (all.length) await quadletDown(ctx, all)
  }

  if (apps.length && (await anyQuadletUp(ctx))) {
    log(`down ${apps.join(' ')} (appliance kept — other apps still up)`)
    return
  }

  await removeAppliance(ctx)
  log('appliance removed')
}
