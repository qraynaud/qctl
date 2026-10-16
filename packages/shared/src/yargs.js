/** @import { Argv, CommandModule } from 'yargs' */

/**
 * Compile-safe stand-in for yargs `.commandDir()`.
 *
 * `commandDir` fs-scans and dynamically requires modules — that breaks under
 * `bun build --compile`. Import command modules statically and pass them here.
 *
 * Modules use the usual yargs shape: `{ command, describe?, aliases?, builder?, handler }`.
 */

/**
 * @typedef {object} YargsCommandModule
 * @property {string | readonly string[]} command
 * @property {string | false} [describe]
 * @property {string | readonly string[]} [aliases]
 * @property {boolean} [deprecated]
 * When true, omitted from default help (`describe: false`) unless `withInternals`.
 * @property {boolean} [internal]
 * @property {(yargs: Argv) => Argv} [builder]
 * `handler` takes `never` so command modules may declare any command-specific argv type.
 * @property {(argv: never) => void | Promise<void>} [handler]
 */

/**
 * @param {string | Error | null | undefined} msg
 * @returns {boolean}
 */
export function isMissingCommandMessage(msg) {
  return typeof msg === 'string' && /Not enough non-option arguments/i.test(msg)
}

/**
 * Missing subcommand (`qctl`, `qctl vm`, …) → show help and exit 0.
 * Unknown args / other validation failures still exit 1.
 *
 * Apply once on each root CLI; nested `.demandCommand(1)` uses the same handler.
 *
 * @template {Argv} T
 * @param {T} yargs
 * @returns {T}
 */
export function exitZeroOnMissingCommand(yargs) {
  return /** @type {T} */ (
    yargs.fail((msg, err, y) => {
      if (err) throw err
      if (isMissingCommandMessage(msg)) {
        // stdout — stderr is often tinted red in terminals
        y.showHelp('log')
        process.exit(0)
      }
      y.showHelp('log')
      if (msg) console.error(`\n${msg}`)
      process.exit(1)
    })
  )
}

/**
 * @template {Argv} T
 * @param {T} yargs
 * @param {readonly YargsCommandModule[]} modules
 * @param {{ withInternals?: boolean }} [opts]
 * @returns {T}
 */
export function registerCommands(yargs, modules, { withInternals = false } = {}) {
  let y = yargs
  for (const mod of modules) {
    /** @type {YargsCommandModule} */
    const registered = mod.internal && !withInternals ? { ...mod, describe: false } : mod
    // yargs accepts the command-module object form; `describe: false` hides from help.
    y = /** @type {T} */ (y.command(/** @type {CommandModule} */ (registered)))
  }
  return y
}
