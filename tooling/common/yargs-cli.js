import yargs from 'yargs'

import { scriptArgs } from './script-args.js'

/** @import { Argv } from 'yargs' */

/**
 * @typedef {object} ToolingYargsOptions
 * @property {boolean} [strict]
 * @property {boolean} [unknownOptionsAsArgs]
 */

/**
 * @param {string} message
 * @returns {never}
 */
export function failParse(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

/**
 * Base yargs instance for tooling scripts (help, no version, shared fail).
 *
 * @param {string[]} args
 * @param {string} scriptName e.g. `tooling/lint.js`
 * @param {ToolingYargsOptions} [options]
 */
export function createToolingYargs(args, scriptName, options = {}) {
  let parser = yargs(args)
    .scriptName(scriptName)
    .help()
    .alias('h', 'help')
    .version(false)
    .fail((msg, err) => {
      failParse(err?.message || msg || 'invalid arguments')
    })

  if (options.strict) {
    parser = parser.strict()
  }
  if (options.unknownOptionsAsArgs) {
    parser = parser.parserConfiguration({
      'unknown-options-as-args': true,
    })
  }

  return parser
}

/**
 * Same as {@link createToolingYargs} using {@link scriptArgs} for `import.meta.url`.
 *
 * @param {string} scriptUrl `import.meta.url` of the entry script
 * @param {string} scriptName
 * @param {ToolingYargsOptions} [options]
 */
export function createToolingYargsFromMeta(scriptUrl, scriptName, options) {
  return createToolingYargs(scriptArgs(scriptUrl), scriptName, options)
}

/**
 * Shared `--fix` boolean option.
 *
 * @template T
 * @param {Argv<T>} y
 * @param {string} [describe]
 */
export function withFixOption(y, describe = 'Apply automatic fixes') {
  return y.option('fix', {
    describe,
    type: 'boolean',
    default: false,
  })
}
