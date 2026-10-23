/** Statically imported `qctl vm` subcommands (bun --compile friendly; no commandDir). */
import * as destroy from './destroy.js'
import * as down from './down.js'
import * as download from './download.js'
import * as initTank from './init-tank.js'
import * as seed from './seed.js'
import * as shell from './shell.js'
import * as sshInfo from './ssh-info.js'
import * as status from './status.js'
import * as targetCheck from './target-check.js'
import * as up from './up.js'

export const vmCommands = [
  seed,
  download,
  up,
  down,
  destroy,
  initTank,
  status,
  sshInfo,
  shell,
  targetCheck,
]
