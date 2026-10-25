import { existsSync } from 'node:fs'

import { ensurePackageDependencies, findPackageRoot } from '@qctl/shared'

import { tryReadOsConfig } from '../../os-config.js'
import { resolveInstanceRoot } from '../../supervisor/quadlet/context.js'
import { detectQctlEnvFor } from '../../supervisor/quadlet/env.js'

/** @import { Argv } from 'yargs' */

export const command = 'ensure'
export const describe =
  'Install instance package.json deps into node_modules (varlock # @plugin resolution)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('dir', {
      type: 'string',
      describe:
        'Directory to start from when locating package.json (default: /etc/qctl/config.json root)',
    })
    .epilogue(
      'Varlock loads third-party plugins from node_modules. qctl runs an in-process '
        + 'Arborist install (production deps only, omit=dev) — no npm CLI. Graph loads '
        + 'also ensure deps when needed. Guest installs are always frozen: require a '
        + 'committed package-lock.json and do not rewrite it.',
    )
}

/**
 * @typedef {object} PluginsEnsureArgv
 * @property {string} [dir]
 */

/**
 * @param {PluginsEnsureArgv} argv
 */
export async function handler(argv) {
  let start
  try {
    start =
      typeof argv.dir === 'string' && argv.dir.trim() ? argv.dir.trim() : resolveInstanceRoot()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  if (!existsSync(start)) {
    console.error(`qctl _internal_plugins ensure: missing dir ${start}`)
    process.exitCode = 1
    return
  }

  const pkgRoot = findPackageRoot(start)
  if (!pkgRoot) {
    console.error(
      `qctl _internal_plugins ensure: no package.json above ${start}\n`
        + '  Add package.json with plugin dependencies (see host `qctl init`).',
    )
    process.exitCode = 1
    return
  }

  try {
    const os = tryReadOsConfig()
    const qctlEnv = detectQctlEnvFor(pkgRoot, { osConfigEnv: os?.env })
    const { installed } = await ensurePackageDependencies(pkgRoot, {
      qctlEnv,
      env: process.env,
      frozen: true,
    })
    if (installed) {
      console.log(`qctl _internal_plugins ensure: installed deps in ${pkgRoot} (frozen)`)
    } else {
      console.log(
        `qctl _internal_plugins ensure: node_modules already satisfied (${pkgRoot}, frozen)`,
      )
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
