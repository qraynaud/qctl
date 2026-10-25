import { runSupervisorDaemon } from '../supervisor/run.js'

/** @import { Argv } from 'yargs' */

export const command = '_internal_supervisor'
export const describe = 'Guest supervisor daemon (apps + admin unix sockets)'
/** Hidden from default `qctl -h` (shown with `--help-with-internals`). */
export const internal = true

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('run-dir', {
      type: 'string',
      describe: 'Runtime dir for sockets/stamps (default /run/qctl)',
    })
    .epilogue(
      'Listens on <run-dir>/apps.sock and <run-dir>/admin.sock. '
        + 'Peer credentials + method allowlists enforce apps vs admin. '
        + 'Identity from /etc/qctl/config.json only.',
    )
}

/**
 * @typedef {object} SupervisorArgv
 * @property {string} [runDir]
 */

/**
 * @param {SupervisorArgv} argv
 */
export async function handler(argv) {
  await runSupervisorDaemon({
    runDir: argv.runDir,
  })
}
