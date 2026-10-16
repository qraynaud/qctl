import { sharedProfile } from '../lib/options.js'
import { ensureAppliance, removeAppliance } from './appliance-lifecycle.js'
import { dumpFailureLogs, quadletDown, quadletUp, waitQuadletHealthy } from './appliance-quadlet.js'
import { createLocalContext } from './context.js'
import { LocalExit, argvApps, log, logDim } from './util.js'

/** @import { Argv } from 'yargs' */

export const command = 'test <apps..>'
export const describe =
  'CI one-shot: disposable appliance (-test-<id>), up apps, wait healthy, always tear down'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return sharedProfile(yargs)
    .positional('apps', {
      type: 'string',
      array: true,
      demandOption: true,
      describe: 'Apps to bring up and wait healthy',
    })
    .strict()
}

/**
 * @typedef {object} LocalTestArgv
 * @property {string} [env]
 * @property {string | string[]} apps
 */

/**
 * Sync remove so `process.exit` / signals still drop the disposable appliance.
 * @param {string} name
 */
function forceRemoveSync(name) {
  try {
    Bun.spawnSync(['podman', '--log-level=fatal', 'rm', '-f', name], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
  } catch {
    // best-effort
  }
}

/**
 * @param {LocalTestArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  const apps = argvApps(argv)
  if (!apps.length) {
    console.error('local: test requires at least one app')
    process.exit(1)
  }
  const label = apps.join(' ')
  log(`test ${label}`)
  logDim('resolving provision + guest tooling…')
  const ctx = await createLocalContext(argv, { disposable: true })
  logDim(`disposable appliance ${ctx.name}`)

  let cleaned = false
  /** @type {Error | null} */
  let error = null

  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    logDim('removing disposable appliance…')
    try {
      await removeAppliance(ctx)
    } catch {
      forceRemoveSync(ctx.name)
    }
  }

  /** @param {NodeJS.Signals} sig */
  const onSignal = (sig) => {
    forceRemoveSync(ctx.name)
    cleaned = true
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  /** @param {NodeJS.Signals} sig */
  const sigHandler = (sig) => () => onSignal(sig)
  const onSigInt = sigHandler('SIGINT')
  const onSigTerm = sigHandler('SIGTERM')
  const onExit = () => {
    if (!cleaned) forceRemoveSync(ctx.name)
  }
  process.once('SIGINT', onSigInt)
  process.once('SIGTERM', onSigTerm)
  process.once('exit', onExit)

  try {
    log('ensure appliance')
    await ensureAppliance(ctx)
    try {
      log(`start ${label} (pull/create may take a while)`)
      await quadletUp(ctx, apps)
      await waitQuadletHealthy(ctx, apps)
    } catch (err) {
      try {
        for (const app of apps) await dumpFailureLogs(ctx, app)
      } catch (dumpErr) {
        console.error(
          'local: failed to collect failure logs:',
          dumpErr instanceof Error ? dumpErr.message : String(dumpErr),
        )
      }
      throw err
    }
    log(`stop ${label}`)
    await quadletDown(ctx, apps)
    log(`ok (${label})`)
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  } finally {
    await cleanup()
    process.off('SIGINT', onSigInt)
    process.off('SIGTERM', onSigTerm)
    process.off('exit', onExit)
  }

  if (error) {
    if (!(error instanceof LocalExit)) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(msg)
    }
    process.exit(1)
  }
}
