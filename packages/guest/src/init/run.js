/**
 * Run `qctl _internal_init`: sync tooling + seed from cidata, then packages + stages.
 */

import { tryReadOsConfig } from '../os-config.js'
import { openCidata } from './cidata.js'
import { createContext } from './context.js'
import { StageError, UnknownStageError } from './errors.js'
import { installInitPackages } from './install-packages.js'
import { loadPlatformModule } from './load-platform.js'
import {
  TIER0_PENDING_DIR_DEFAULT,
  loadSecretsFromTier0Pending,
  loadSeedFromIso,
} from './load-seed-config.js'
import { runStage } from './run-stage.js'
import { stagesForProfile } from './stages.js'
import { SKIP_CIDATA_SYNC_ENV, reexecAfterSelfUpdate, syncToolingFromIso } from './sync-from-iso.js'

/**
 * @import {
 *   InitProfile,
 *   OsConfig,
 *   PlatformModule,
 *   PlatformStage,
 *   SeedConfig,
 * } from '@qctl/shared'
 */
/** @import { CidataHandle, OpenCidataDeps } from './cidata.js' */
/** @import { StageContext } from './context.js' */
/** @import { LoadSeedDeps, LoadSeedResult } from './load-seed-config.js' */
/** @import { SyncFromIsoDeps, SyncFromIsoResult } from './sync-from-iso.js' */

/**
 * @typedef {(deps: OpenCidataDeps) => Promise<CidataHandle>} OpenCidataFn
 * @typedef {(
 *   cidata: Pick<CidataHandle, 'guestDir'>,
 *   deps: SyncFromIsoDeps,
 * ) => SyncFromIsoResult} SyncToolingFromIsoFn
 * @typedef {(
 *   cidata: Pick<CidataHandle, 'root' | 'seedDir'>,
 *   deps: LoadSeedDeps,
 * ) => LoadSeedResult} LoadSeedFromIsoFn
 * @typedef {(
 *   opts: Parameters<typeof reexecAfterSelfUpdate>[0],
 * ) => Promise<number>} ReexecAfterSelfUpdateFn
 */

/**
 * @typedef {object} InitDeps
 * @property {Record<string, string | undefined>} [env]
 * @property {(line: string) => void} [log]
 * @property {(line: string) => void} [logError]
 * @property {() => Promise<PlatformModule>} [loadPlatform]
 * @property {boolean} [skipPackages]
 * @property {boolean} [skipCidataSync] Skip ISO tooling + seed load (unit tests).
 * @property {OpenCidataFn} [openCidata]
 * @property {SyncToolingFromIsoFn} [syncToolingFromIso]
 * @property {LoadSeedFromIsoFn} [loadSeedFromIso]
 * @property {ReexecAfterSelfUpdateFn} [reexecAfterSelfUpdate]
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
  const open = deps.openCidata ?? openCidata
  const syncTooling = deps.syncToolingFromIso ?? syncToolingFromIso
  const loadSeed = deps.loadSeedFromIso ?? loadSeedFromIso
  const reexec = deps.reexecAfterSelfUpdate ?? reexecAfterSelfUpdate

  let stages
  try {
    stages = [...stagesForProfile(opts.profile)]
  } catch (err) {
    logError(`qctl _internal_init: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (opts.from) {
    const idx = stages.indexOf(/** @type {PlatformStage} */ (opts.from))
    if (idx < 0) {
      logError(
        `qctl _internal_init: --from ${opts.from}: not a stage of profile ${opts.profile} (${stages.join(', ')})`,
      )
      return 1
    }
    stages = stages.slice(idx)
  }

  log(`qctl _internal_init: profile=${opts.profile}${opts.dryRun ? ' (dry-run)' : ''}`)

  /** @type {SeedConfig | undefined} */
  let seedConfig
  /** @type {OsConfig | undefined} */
  let osConfig
  /** @type {Record<string, string>} */
  let secrets = {}

  const skipCidataSync = Boolean(deps.skipCidataSync) || env[SKIP_CIDATA_SYNC_ENV] === '1'
  if (!skipCidataSync) {
    /** @type {CidataHandle | undefined} */
    let cidata
    try {
      cidata = await open({ env })
      const sync = syncTooling({ guestDir: cidata.guestDir }, { env, log })
      if (sync.disposition === 'reexec') {
        log('qctl _internal_init: guest binary updated — re-exec')
        await cidata.close().catch(() => {})
        cidata = undefined
        return await reexec({ env })
      }
      const loaded = loadSeed({ root: cidata.root, seedDir: cidata.seedDir }, { env, log })
      seedConfig = loaded.seed
      osConfig = loaded.os
      secrets = loaded.secrets
    } catch (err) {
      logError(
        `qctl _internal_init: cidata sync: ${err instanceof Error ? err.message : String(err)}`,
      )
      return 1
    } finally {
      if (cidata) await cidata.close().catch(() => {})
    }
  } else {
    // Day-2 / test skip: identity from /etc/qctl/config.json (or QCTL_OS_CONFIG).
    osConfig = tryReadOsConfig(env.QCTL_OS_CONFIG?.trim() || undefined)
    if (osConfig) {
      secrets = loadSecretsFromTier0Pending(TIER0_PENDING_DIR_DEFAULT)
    }
  }

  /** @type {PlatformModule | undefined} */
  let platform
  try {
    platform = await loadPlatform()
  } catch (err) {
    logError(`qctl _internal_init: platform: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (!deps.skipPackages) {
    try {
      await installInitPackages({
        profile: opts.profile,
        env,
        log,
        dryRun: opts.dryRun,
        seedConfig,
        loadPlatform: async () => /** @type {PlatformModule} */ (platform),
      })
    } catch (err) {
      logError(`qctl _internal_init: packages: ${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  }

  const ctxPatch = deps.ctx ?? {}
  if (!osConfig && !seedConfig && !ctxPatch.osConfig && !ctxPatch.seedConfig) {
    logError('qctl _internal_init: need cidata qctl-seed/ or /etc/qctl/config.json')
    return 1
  }

  const ctx = createContext({
    profile: opts.profile,
    dryRun: Boolean(opts.dryRun),
    spawnEnv: env,
    secrets,
    log,
    platform,
    ...(seedConfig ? { seedConfig, ports: seedConfig.ports } : {}),
    ...(osConfig ? { osConfig } : {}),
    ...ctxPatch,
  })

  for (const stage of stages) {
    log(`== ${stage}`)
    try {
      await runOne(stage, ctx)
    } catch (err) {
      if (err instanceof UnknownStageError || err instanceof StageError) {
        logError(`qctl _internal_init: ${err.message}`)
      } else {
        logError(
          `qctl _internal_init: stage ${stage} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return 1
    }
  }
  log(`qctl _internal_init: done (${stages.length} stages)`)
  return 0
}
