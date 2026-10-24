/**
 * Run a single init stage (debug / resume). Prefer `_internal_init --from` for
 * ordered resume; this loads ISO seed (or existing OS config) so stages see the
 * same context as first-boot.
 */
import { openCidata } from '../init/cidata.js'
import { createContext } from '../init/context.js'
import { StageError, UnknownStageError } from '../init/errors.js'
import {
  TIER0_PENDING_DIR_DEFAULT,
  loadSecretsFromTier0Pending,
  loadSeedFromIso,
} from '../init/load-seed-config.js'
import { runStage } from '../init/run-stage.js'
import { ALL_STAGES, PROFILES } from '../init/stages.js'
import { tryReadOsConfig } from '../os-config.js'

/** @import { Argv } from 'yargs' */
/** @import { OsConfig, SeedConfig } from '@qctl/shared' */

export const command = '_internal_stage <name>'
export const describe = 'Run a single init stage'
/** Hidden from default `qctl -h` (shown with `--help-with-internals`). */
export const internal = true

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: `Stage name (${ALL_STAGES.join(' | ')})`,
    })
    .option('profile', {
      type: 'string',
      choices: PROFILES,
      default: 'default',
      describe: 'Init profile the stage is running under',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Print what would run; no side effects',
    })
}

/**
 * @typedef {object} StageArgv
 * @property {string} name
 * @property {string} [profile]
 * @property {boolean} [dryRun]
 */

/**
 * @param {StageArgv} argv
 */
export async function handler(argv) {
  const name = String(argv.name)
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env }
  /** @type {SeedConfig | undefined} */
  let seedConfig
  /** @type {OsConfig | undefined} */
  let osConfig
  /** @type {Record<string, string>} */
  let secrets = {}

  /** @type {Awaited<ReturnType<typeof openCidata>> | undefined} */
  let cidata
  try {
    cidata = await openCidata({ env })
    const loaded = loadSeedFromIso(cidata, { env, log: (line) => console.log(line) })
    seedConfig = loaded.seed
    osConfig = loaded.os
    secrets = loaded.secrets
  } catch (cidataErr) {
    osConfig = tryReadOsConfig()
    if (osConfig) {
      secrets = loadSecretsFromTier0Pending(TIER0_PENDING_DIR_DEFAULT)
      console.log(
        `qctl _internal_stage: no cidata (${cidataErr instanceof Error ? cidataErr.message : String(cidataErr)}) — using /etc/qctl/config.json only`,
      )
    } else {
      console.error(
        `qctl _internal_stage: need cidata qctl-seed/ or /etc/qctl/config.json\n`
          + `  cidata: ${cidataErr instanceof Error ? cidataErr.message : String(cidataErr)}`,
      )
      process.exitCode = 1
      return
    }
  } finally {
    if (cidata) await cidata.close().catch(() => {})
  }

  const ctx = createContext({
    profile: /** @type {'default' | 'init-tank'} */ (argv.profile ?? 'default'),
    dryRun: Boolean(argv.dryRun),
    secrets,
    ...(seedConfig ? { seedConfig, ports: seedConfig.ports } : {}),
    ...(osConfig ? { osConfig } : {}),
  })
  try {
    await runStage(name, ctx)
  } catch (err) {
    if (err instanceof UnknownStageError) {
      console.error(err.message)
      console.error(`known: ${ALL_STAGES.join(', ')}`)
    } else if (err instanceof StageError) {
      console.error(`qctl: ${err.message}`)
    } else {
      console.error(`qctl: ${err instanceof Error ? err.message : String(err)}`)
    }
    process.exitCode = 1
  }
}
