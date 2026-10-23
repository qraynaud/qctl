import * as clack from '@clack/prompts'
import { chalk } from 'zx'

import { registerCommands } from '@qctl/shared'

import { isInteractiveTty } from '../init/quickstart.js'
import * as app from './new/app.js'
import * as common from './new/common.js'
import * as env from './new/env.js'
import * as network from './new/network.js'
import * as profile from './new/profile.js'
import * as unit from './new/unit.js'
/** @import { Argv } from 'yargs' */

export const command = 'new'
export const describe =
  'Add app / common / network / unit / env / profile stubs (bare → TTY picker)'

/** @typedef {'profile' | 'env' | 'app' | 'unit' | 'network' | 'common'} NewKind */

/** @type {readonly { value: NewKind, label: string, hint: string }[]} */
const KIND_OPTIONS = Object.freeze([
  { value: 'profile', label: 'profile', hint: 'VM profile (e.g. Proxmox)' },
  { value: 'env', label: 'env', hint: 'provision environment' },
  { value: 'app', label: 'app', hint: 'applications/<name> (+ units)' },
  { value: 'unit', label: 'unit', hint: 'unit under an existing app' },
  { value: 'network', label: 'network', hint: 'networks/<name>' },
  { value: 'common', label: 'common', hint: 'common/<name>' },
])

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  // No demandCommand: bare `qctl new` reaches {@link handler} for the TTY picker.
  return registerCommands(yargs, [app, common, network, unit, env, profile])
    .strictCommands()
    .epilog(
      'Bare `qctl new` on a TTY opens a kind picker.\n'
        + 'Profile (e.g. Proxmox): qctl new profile [name] — keep lab; do not --force init.',
    )
}

/**
 * Dispatch to a subcommand handler with empty argv (each subcommand prompts on TTY).
 * @param {NewKind} kind
 */
export async function runNewKind(kind) {
  switch (kind) {
    case 'profile':
      await profile.handler({})
      return
    case 'env':
      await env.handler({})
      return
    case 'app':
      await app.handler({})
      return
    case 'unit':
      await unit.handler({})
      return
    case 'network':
      await network.handler({})
      return
    case 'common':
      await common.handler({})
      return
    default: {
      const _exhaustive = /** @type {never} */ (kind)
      throw new Error(`unknown new kind: ${String(_exhaustive)}`)
    }
  }
}

/**
 * @typedef {{
 *   intro?: (title?: string) => void
 *   cancel?: (message?: string) => void
 *   isCancel: (value: string | symbol) => boolean
 *   select: (opts: {
 *     message: string
 *     options: { value: string, label: string, hint?: string }[]
 *     initialValue?: string
 *   }) => Promise<string | symbol>
 * }} NewKindPrompts
 */

/**
 * Interactive kind picker for bare `qctl new`.
 * @param {{ prompts?: NewKindPrompts }} [opts]
 */
export async function promptNewKind(opts = {}) {
  const p = opts.prompts ?? /** @type {NewKindPrompts} */ (clack)
  p.intro?.(chalk.cyan('qctl new'))
  const picked = await p.select({
    message: 'What do you want to create?',
    options: [...KIND_OPTIONS],
    initialValue: 'app',
  })
  if (p.isCancel(picked)) {
    p.cancel?.('Cancelled')
    throw new Error('cancelled')
  }
  return /** @type {NewKind} */ (picked)
}

/**
 * Bare `qctl new` — TTY picker → subcommand; non-TTY fails with a hint.
 * Subcommands own their own handlers (parent is not invoked when a kind is passed).
 */
export async function handler() {
  try {
    if (!isInteractiveTty()) {
      console.error(
        'Specify a kind: qctl new <profile|env|app|unit|network|common>\n'
          + 'Or run on a TTY for an interactive picker.',
      )
      process.exitCode = 1
      return
    }
    const kind = await promptNewKind()
    await runNewKind(kind)
  } catch (err) {
    if (err instanceof Error && err.message === 'cancelled') {
      process.exitCode = 1
      return
    }
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
