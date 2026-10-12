import { chalk } from 'zx'

/** Thrown by `die` so callers (e.g. `local test`) can clean up before exiting. */
export class LocalExit extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'LocalExit'
  }
}

/**
 * @param {string} msg
 * @returns {never}
 */
export function die(msg) {
  console.error(chalk.red(`local: ${msg}`))
  throw new LocalExit(msg)
}

/**
 * @param {string} msg
 */
export function log(msg) {
  console.log(chalk.cyan('local:'), msg)
}

/**
 * @param {string} msg
 */
export function logDim(msg) {
  console.log(chalk.dim(`local: ${msg}`))
}

/**
 * Normalize yargs `apps` / legacy `app` into a string list.
 * @param {{ apps?: string | string[], app?: string | string[] }} argv
 * @returns {string[]}
 */
export function argvApps(argv) {
  const raw = argv.apps ?? argv.app
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string' && raw) return [raw]
  return []
}
