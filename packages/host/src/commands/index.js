/** Statically imported host commands (bun --compile friendly). */
import * as init from './init.js'
import * as local from './local.js'
import * as newCmd from './new.js'
import * as seedKit from './seed-kit.js'
import * as sync from './sync.js'
import * as vm from './vm.js'

/** Happy path first: init → vm → new → sync; then local / seed-kit (advanced). */
export const commands = [init, vm, newCmd, sync, local, seedKit]
