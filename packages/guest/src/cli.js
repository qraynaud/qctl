#!/usr/bin/env bun
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { QCTL_VERSION, exitZeroOnMissingCommand, registerCommands } from '@qctl/shared'

import { commands } from './commands/index.js'
import { ensureGuestNativeHelper } from './native-helper.js'

await ensureGuestNativeHelper()

const HELP_WITH_INTERNALS = '--help-with-internals'
const rawArgv = hideBin(process.argv)
const withInternals = rawArgv.includes(HELP_WITH_INTERNALS)
/** Strip the flag so yargs never sees an unknown option. */
const filtered = rawArgv.filter((a) => a !== HELP_WITH_INTERNALS)
const hasCommand = filtered.some((a) => !a.startsWith('-'))
const explicitHelp = filtered.includes('--help') || filtered.includes('-h')
// Bare `--help-with-internals` (no subcommand) → show full help.
const parseArgv =
  withInternals && !hasCommand
    ? [...filtered.filter((a) => a !== '--help' && a !== '-h'), '--help']
    : filtered

/** Document internals only when help was asked for explicitly (not bare `qctl`). */
const showInternalsHint = withInternals || explicitHelp

let cli = registerCommands(yargs(parseArgv), commands, { withInternals })
  .scriptName('qctl')
  .version(`${QCTL_VERSION} (guest)`)
  .usage('$0 <command> [options]')
  .demandCommand(1)
  .strictCommands()
  .help()
  .alias('h', 'help')

if (showInternalsHint) {
  cli = cli.epilogue(
    withInternals
      ? 'Internal commands (_internal_*) are listed above (first-boot / debug / plugin tooling).'
      : `Internal first-boot / debug commands (_internal_*): qctl ${HELP_WITH_INTERNALS}`,
  )
}

await exitZeroOnMissingCommand(cli).parse()
