import { detectQctlEnv, hydrateStageEnv } from './stages/lib/credentials.js'

/** @import { PlatformModule, PlatformStageContext } from '@qctl/shared' */

/**
 * @typedef {object} ExecResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Runtime context handed to every stage. Everything with side effects is injectable
 * so stages can be unit-tested without root / systemd / ZFS.
 *
 * @typedef {PlatformStageContext & {
 *   env: Record<string, string | undefined>,
 *   log: (line: string) => void,
 *   isRoot: () => boolean,
 *   runBash: (source: string, label: string) => Promise<number>,
 *   exec: (argv: string[]) => Promise<ExecResult>,
 *   platform?: PlatformModule,
 * }} StageContext
 */

/**
 * Ensure `QCTL_ENV` is set (default `dev`) and hydrate `$CREDENTIALS_DIRECTORY`.
 *
 * @param {Record<string, string | undefined>} base
 * @returns {Record<string, string | undefined>}
 */
export function envWithQctlEnv(base) {
  const qctlEnv = detectQctlEnv(base)
  /** @type {Record<string, string | undefined>} */
  const env = base.QCTL_ENV?.trim() === qctlEnv ? { ...base } : { ...base, QCTL_ENV: qctlEnv }
  hydrateStageEnv(env)
  return env
}

/**
 * @param {string} source bash script text
 * @param {string} label `$0` for the script (shows up in bash error messages)
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
 * @param {Partial<StageContext>} [overrides]
 * @returns {StageContext}
 */
export function createContext(overrides = {}) {
  const env = envWithQctlEnv(overrides.env ?? process.env)
  const { env: _drop, ...rest } = overrides
  return {
    profile: 'default',
    dryRun: false,
    log: (line) => console.log(line),
    isRoot: () => typeof process.getuid === 'function' && process.getuid() === 0,
    runBash: (source, label) => spawnBash(source, label, env),
    exec: (argv) => spawnCapture(argv, env),
    ...rest,
    env,
  }
}
