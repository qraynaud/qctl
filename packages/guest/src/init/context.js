/**
 * Runtime context for init stages.
 * Identity/topology: {@link StageContext.osConfig} / {@link StageContext.seedConfig}.
 * Tier-0 secrets: {@link StageContext.secrets}.
 * Test path overrides: {@link StageContext.paths}.
 * Spawn uses process.env + secrets internally (not a public config bag).
 */
import { hydrateSystemdCredentials, seedConfigToOsConfig } from '@qctl/shared'

/**
 * @import {
 *   OsConfig,
 *   PlatformModule,
 *   PlatformStageContext,
 *   PortsMap,
 *   SeedConfig,
 *   SeedInterfaces,
 * } from '@qctl/shared'
 */

/**
 * @typedef {object} ExecResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Optional path overrides (unit tests / rare escapes). Production uses FHS defaults.
 *
 * @typedef {object} StagePaths
 * @property {string} [qctlVarDir]
 * @property {string} [initState]
 * @property {string} [firstBootStamp]
 * @property {string} [initTankStamp]
 * @property {string} [tier0Pending]
 * @property {string} [tier0Encrypted]
 * @property {string} [fstab]
 * @property {string} [adminKeys]
 * @property {string} [sudoersDropin]
 * @property {string} [credstoreDir]
 * @property {string} [tankCredFile]
 * @property {string} [tankMount]
 * @property {string} [zfsListCacheDir]
 * @property {string} [routeLocalnetConf]
 * @property {string} [hgBin]
 * @property {string} [sshConfig]
 * @property {string} [deploySshHost]
 */

/**
 * @typedef {object} StageFlags
 * @property {boolean} [skipZfsDrill]
 * @property {boolean} [tankCreateConfirmed]
 * @property {number} [tankMountAttempts] Mount retry count (default 20; tests lower it).
 * @property {number} [tankMountRetryMs] Delay between mount retries (default 250; tests use 0).
 */

/**
 * @typedef {PlatformStageContext & {
 *   osConfig: OsConfig,
 *   seedConfig?: SeedConfig,
 *   ports?: PortsMap,
 *   interfaces?: SeedInterfaces,
 *   secrets: Record<string, string>,
 *   paths: StagePaths,
 *   flags: StageFlags,
 *   log: (line: string) => void,
 *   isRoot: () => boolean,
 *   runBash: (source: string, label: string) => Promise<number>,
 *   exec: (argv: string[]) => Promise<ExecResult>,
 *   platform?: PlatformModule,
 * }} StageContext
 */

/**
 * Collect Tier-0 / systemd credential secrets into a plain map.
 *
 * @param {Record<string, string | undefined>} processEnv
 * @param {Record<string, string | undefined>} [extra]
 * @returns {Record<string, string>}
 */
export function collectSecrets(processEnv, extra = {}) {
  /** @type {Record<string, string | undefined>} */
  const bag = { ...extra }
  // Systemd LoadCredential* → CREDENTIALS_DIRECTORY
  const dir = processEnv.CREDENTIALS_DIRECTORY
  if (dir) bag.CREDENTIALS_DIRECTORY = dir
  hydrateSystemdCredentials(bag)
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(bag)) {
    if (k === 'CREDENTIALS_DIRECTORY') continue
    if (v == null || String(v).trim() === '') continue
    out[k] = String(v)
  }
  return out
}

/**
 * @param {string} source
 * @param {string} label
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>}
 */
export async function spawnBash(source, label, env) {
  const proc = Bun.spawn(['bash', '-c', source, label], {
    env: /** @type {Record<string, string>} */ (env),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return proc.exited
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<ExecResult>}
 */
export async function spawnCapture(argv, env) {
  try {
    const proc = Bun.spawn(argv, {
      env: /** @type {Record<string, string>} */ (env),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stdout, stderr }
  } catch (err) {
    return { code: 127, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * @param {Partial<StageContext> & {
 *   secrets?: Record<string, string | undefined>,
 *   spawnEnv?: Record<string, string | undefined>,
 * }} [overrides]
 * @returns {StageContext}
 */
export function createContext(overrides = {}) {
  const processEnv = overrides.spawnEnv ?? process.env
  const secrets = collectSecrets(processEnv, overrides.secrets)
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...processEnv, ...secrets }

  const osConfig =
    overrides.osConfig
    ?? (overrides.seedConfig ? seedConfigToOsConfig(overrides.seedConfig) : undefined)
  if (!osConfig) {
    throw new Error('createContext: osConfig or seedConfig required')
  }

  const paths = { ...(overrides.paths || {}) }
  const flags = {
    skipZfsDrill: overrides.flags?.skipZfsDrill ?? processEnv.ROCKY_SKIP_ZFS_DRILL === '1',
    tankCreateConfirmed:
      overrides.flags?.tankCreateConfirmed ?? processEnv.ROCKY_TANK_CREATE_I_UNDERSTAND === 'yes',
    ...(overrides.flags?.tankMountAttempts != null
      ? { tankMountAttempts: overrides.flags.tankMountAttempts }
      : {}),
    ...(overrides.flags?.tankMountRetryMs != null
      ? { tankMountRetryMs: overrides.flags.tankMountRetryMs }
      : {}),
  }

  const {
    osConfig: _o,
    seedConfig: _s,
    secrets: _sec,
    paths: _p,
    flags: _f,
    spawnEnv: _sp,
    ...rest
  } = overrides

  return {
    profile: 'default',
    dryRun: false,
    log: (line) => console.log(line),
    isRoot: () => typeof process.getuid === 'function' && process.getuid() === 0,
    runBash: (source, label) => spawnBash(source, label, childEnv),
    exec: (argv) => spawnCapture(argv, childEnv),
    ...rest,
    osConfig,
    ...(overrides.seedConfig ? { seedConfig: overrides.seedConfig } : {}),
    ...(overrides.ports
      ? { ports: overrides.ports }
      : overrides.seedConfig?.networking?.ports
        ? { ports: overrides.seedConfig.networking.ports }
        : {}),
    ...(overrides.interfaces
      ? { interfaces: overrides.interfaces }
      : overrides.seedConfig?.networking?.interfaces
        ? { interfaces: overrides.seedConfig.networking.interfaces }
        : {}),
    secrets,
    paths,
    flags,
  }
}
