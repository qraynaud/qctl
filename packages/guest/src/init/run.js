/**
 * Run `qctl init`: install platform packages, then ordered stages in-process.
 */

import { createContext } from './context.js'
import { StageError, UnknownStageError } from './errors.js'
import { installInitPackages } from './install-packages.js'
import { loadPlatformModule } from './load-platform.js'
import { runStage } from './run-stage.js'
import { stagesForProfile } from './stages.js'

/** @import { InitProfile, PlatformModule, PlatformStage } from '@qctl/shared' */
/** @import { StageContext } from './context.js' */

/**
 * @typedef {object} InitDeps
 * @property {Record<string, string | undefined>} [env]
 * @property {(line: string) => void} [log]
 * @property {(line: string) => void} [logError]
 * @property {() => Promise<PlatformModule>} [loadPlatform]
 * @property {boolean} [skipPackages]
 * @property {(name: string, ctx: StageContext) => Promise<void>} [runStage]
 * @property {Partial<StageContext>} [ctx]
 */

/**
 * @typedef {object} RunInitOpts
 * @property {InitProfile} profile
 * @property {boolean} [dryRun]
 * @property {string} [from] resume at this stage (inclusive)
 */

/**
 * @param {RunInitOpts} opts
 * @param {InitDeps} [deps]
 * @returns {Promise<number>} process exit code
 */
export async function runInit(opts, deps = {}) {
  const env = deps.env ?? process.env
  const log = deps.log ?? ((l) => console.log(l))
  const logError = deps.logError ?? ((l) => console.error(l))
  const runOne = deps.runStage ?? runStage
  const loadPlatform = deps.loadPlatform ?? (() => loadPlatformModule(env))

  let stages
  try {
    stages = [...stagesForProfile(opts.profile)]
  } catch (err) {
    logError(`qctl init: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (opts.from) {
    const idx = stages.indexOf(/** @type {PlatformStage} */ (opts.from))
    if (idx < 0) {
      logError(
        `qctl init: --from ${opts.from}: not a stage of profile ${opts.profile} (${stages.join(', ')})`,
      )
      return 1
    }
    stages = stages.slice(idx)
  }

  log(`qctl init: profile=${opts.profile}${opts.dryRun ? ' (dry-run)' : ''}`)

  /** @type {PlatformModule | undefined} */
  let platform
  try {
    platform = await loadPlatform()
  } catch (err) {
    logError(`qctl init: platform: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (!deps.skipPackages) {
    try {
      await installInitPackages({
        profile: opts.profile,
        env,
        log,
        dryRun: opts.dryRun,
        loadPlatform: async () => /** @type {PlatformModule} */ (platform),
      })
    } catch (err) {
      logError(`qctl init: packages: ${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  }

  const ctx = createContext({
    profile: opts.profile,
    dryRun: Boolean(opts.dryRun),
    env,
    log,
    platform,
    ...deps.ctx,
  })

  for (const stage of stages) {
    log(`== ${stage}`)
    try {
      await runOne(stage, ctx)
    } catch (err) {
      if (err instanceof UnknownStageError || err instanceof StageError) {
        logError(`qctl init: ${err.message}`)
      } else {
        logError(
          `qctl init: stage ${stage} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return 1
    }
  }
  log(`qctl init: done (${stages.length} stages)`)
  return 0
}
