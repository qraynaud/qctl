import { asyncExitHook } from 'exit-hook'

import { runAppProxyRelease, runAppProxyStart } from '../supervisor/proxy.js'

/** @import { Argv } from 'yargs' */

export const command = '_internal_app_proxy <app>'
export const describe = 'qctl-app@ proxy (Type=notify ensure/watch; --release on ExecStop)'
/** Hidden from default `qctl -h` (shown with `--help-with-internals`). */
export const internal = true

/** Allow watch abort + reply before exit-hook terminates the process. */
const STOP_WAIT_MS = 10_000

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('app', {
      type: 'string',
      describe: 'Application / systemd template instance name (%i)',
      demandOption: true,
    })
    .option('release', {
      type: 'boolean',
      default: false,
      describe: 'ExecStop path: supervisor release (refcount--)',
    })
    .option('run-dir', {
      type: 'string',
      describe: 'Runtime dir for sockets/stamps (default /run/qctl)',
    })
    .epilogue(
      'Used by qctl-app@.service on system and user buses. '
        + 'Talks to apps.sock only (peercred).',
    )
}

/**
 * @typedef {object} AppProxyArgv
 * @property {string} app
 * @property {boolean} [release]
 * @property {string} [runDir]
 */

/**
 * @param {AppProxyArgv} argv
 */
export async function handler(argv) {
  if (argv.release) {
    const code = await runAppProxyRelease({
      app: argv.app,
      runDir: argv.runDir,
      exitProcess: false,
    })
    process.exitCode = code
    return
  }

  const ac = new AbortController()
  /** @type {Promise<number>} */
  const running = runAppProxyStart({
    app: argv.app,
    runDir: argv.runDir,
    signal: ac.signal,
    exitProcess: false,
  })

  const unsub = asyncExitHook(
    async () => {
      ac.abort()
      await running
    },
    { wait: STOP_WAIT_MS },
  )

  try {
    process.exitCode = await running
  } finally {
    unsub()
  }
}
