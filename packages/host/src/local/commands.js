/** Statically imported `qctl local` subcommands. */
import * as down from './down.js'
import * as logs from './logs.js'
import * as ps from './ps.js'
import * as shell from './shell.js'
import * as testCmd from './test.js'
import * as up from './up.js'

export const localCommands = [up, testCmd, down, shell, ps, logs]
