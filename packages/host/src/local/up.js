import { sharedProfile } from '../lib/options.js'
import { ensureAppliance } from './appliance-lifecycle.js'
import { quadletUp, quadletUpAll } from './appliance-quadlet.js'
import { listInstanceApps } from './apps.js'
import { createLocalContext } from './context.js'
import { die, log } from './util.js'

/** @import { Argv } from 'yargs' */

export const command = 'up [apps..]'
export const describe = 'Start the nested appliance; optionally quadlet up apps (leave running)'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedProfile(yargs)
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'Apps to start (omit for appliance only)',
    })
    .option('all', {
      type: 'boolean',
      default: false,
      describe: 'Start every discovered app',
    })
    .strict()
}

/**
 * @typedef {object} LocalUpArgv
 * @property {string} [env]
 * @property {string[]} [apps]
 * @property {boolean} [all]
 */

/**
 * @param {LocalUpArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const ctx = await createLocalContext(argv)
  await ensureAppliance(ctx)

  if (argv.all) {
    if (argv.apps?.length) {
      die('pass either --all or app names, not both')
    }
    const apps = listInstanceApps(ctx.root)
    if (!apps.length) {
      die('no applications/*/app.yaml found')
    }
    await quadletUpAll(ctx)
    log(`up (all: ${apps.join(', ')})`)
    return
  }

  const apps = argv.apps ?? []
  if (apps.length) await quadletUp(ctx, apps)
  if (apps.length) {
    log(`up (${apps.join(', ')})`)
  } else {
    log(`appliance ready (${ctx.name})`)
  }
}
