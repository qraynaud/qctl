import { runInit } from '../init/run.js'

/** @import { Argv } from 'yargs' */
/** @import { InitProfile } from '@qctl/shared' */

export const command = 'init'
export const describe = 'First-boot / appliance init (systemd); runs ordered stages'
/** Hidden from default `qctl -h` (shown with `--help-with-internals`). */
export const internal = true

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('profile', {
      type: 'string',
      choices: ['default', 'init-tank'],
      default: 'default',
      describe: 'Init profile (default = appliance first boot; init-tank = tank prep VM)',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Run every stage with --dry-run (print only; no side effects)',
    })
    .option('from', {
      type: 'string',
      describe: 'Resume at this stage (inclusive) after a failure',
    })
    .epilogue(
      'Platform packages: dynamically import $QCTL_PLATFORM_MODULE '
        + '(default /usr/local/lib/qctl/qctl-platform-rocky.mjs).\n'
        + 'Runs before the instance repo exists; stops at the first failing stage.',
    )
}

/**
 * @typedef {object} GuestInitArgv
 * @property {string} [profile]
 * @property {boolean} [dryRun]
 * @property {string} [from]
 */

/**
 * @param {GuestInitArgv} argv
 */
export async function handler(argv) {
  const code = await runInit({
    profile: /** @type {InitProfile} */ (argv.profile ?? 'default'),
    dryRun: Boolean(argv.dryRun),
    from: typeof argv.from === 'string' && argv.from ? argv.from : undefined,
  })
  if (code !== 0) process.exitCode = code
}
