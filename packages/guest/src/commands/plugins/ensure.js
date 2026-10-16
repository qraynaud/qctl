import { existsSync } from 'node:fs'

import { ensurePackageDependencies, findInstanceRoot, findPackageRoot } from '@qctl/shared'

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
        'Directory to start from when locating package.json (default: instance root or cwd)',
    })
    .epilogue(
      'Varlock loads third-party plugins from node_modules. qctl runs an in-process '
        + 'npm install (Arborist) — no npm CLI required. Graph loads also ensure deps '
        + 'when needed. Frozen (package-lock only, no lock rewrite) when CI=true or '
        + 'QCTL_ENV is not dev.',
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
  const start =
    typeof argv.dir === 'string' && argv.dir.trim()
      ? argv.dir.trim()
      : findInstanceRoot(process.cwd()) || process.cwd()

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
    const { installed, frozen } = await ensurePackageDependencies(pkgRoot, {
      qctlEnv: process.env.QCTL_ENV,
      env: process.env,
    })
    const mode = frozen ? 'frozen' : 'mutable'
    if (installed) {
      console.log(`qctl _internal_plugins ensure: installed deps in ${pkgRoot} (${mode})`)
    } else {
      console.log(
        `qctl _internal_plugins ensure: node_modules already satisfied (${pkgRoot}, ${mode})`,
      )
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
