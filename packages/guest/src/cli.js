#!/usr/bin/env bun
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { QCTL_VERSION, exitZeroOnMissingCommand, registerCommands } from '@qctl/shared'

import { commands } from './commands/index.js'
import { ensureGuestNativeHelper } from './native-helper.js'

await ensureGuestNativeHelper()

await exitZeroOnMissingCommand(
  registerCommands(yargs(hideBin(process.argv)), commands)
    .scriptName('qctl')
    .version(`${QCTL_VERSION} (guest)`)
    .usage('$0 <command> [options]')
    .demandCommand(1)
    .strictCommands()
    .help()
    .alias('h', 'help'),
).parse()
