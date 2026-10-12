import { applianceRunning, dumpFailureLogs } from './appliance.js'
import { createLocalContext } from './context.js'
import { execInAppliance } from './exec-in.js'
import { sharedLocalEnv } from './options.js'
import { stripPodmanNoise } from './podman.js'
import { argvApps, die } from './util.js'

/** @import { Argv } from 'yargs' */

export const command = 'logs [apps..]'
export const describe = 'Journal / podman logs from the appliance'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedLocalEnv(yargs)
    .positional('apps', {
      type: 'string',
      array: true,
      describe: 'App / unit names (omit for recent appliance journals)',
    })
    .option('follow', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Follow journal for one app unit',
    })
    .strict()
}

/**
 * @typedef {object} LocalLogsArgv
 * @property {string} [env]
 * @property {string | string[]} [apps]
 * @property {boolean} [follow]
 */

/**
 * @param {LocalLogsArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const ctx = await createLocalContext(argv)
  if (!(await applianceRunning(ctx))) {
    die(`appliance ${ctx.name} is not running`)
  }

  const apps = argvApps(argv)
  if (argv.follow) {
    if (apps.length !== 1) die('--follow requires exactly one app name')
    const q = apps[0].replace(/'/g, `'\\''`)
    await execInAppliance(ctx, `journalctl -u '${q}.service' -f --no-pager`, {
      inherit: true,
    })
    return
  }

  if (apps.length) {
    for (const app of apps) await dumpFailureLogs(ctx, app)
    return
  }

  const r = await execInAppliance(
    ctx,
    `
set +e
uid=$(id -u apps)
journalctl -n 80 --no-pager || true
journalctl _UID="$uid" -n 80 --no-pager || true
`,
    { nothrow: true },
  )
  const out = stripPodmanNoise(`${r.stdout}${r.stderr}`).trim()
  if (out) console.log(out)
}
