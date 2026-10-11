import { existsSync } from 'node:fs'

import { BOOTSTRAP_DIR_DEFAULT, ensureNpmPluginsFromDir, resolveBootstrapDir } from '@qctl/shared'

/** @import { Argv } from 'yargs' */

export const command = 'ensure'
export const describe =
  'Download `# @plugin(name@version)` pins into plugins-cache (like `varlock install-plugin`)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .option('dir', {
      type: 'string',
      array: true,
      describe:
        'Env-spec directory to scan (repeatable). Default: bootstrap dir '
        + `(${BOOTSTRAP_DIR_DEFAULT} or $QCTL_BOOTSTRAP_DIR)`,
    })
    .epilogue(
      'Writes to `$XDG_CONFIG_HOME/varlock/plugins-cache` (default `~/.config/varlock/plugins-cache`).\n'
        + 'Guest cloud-init runs this after installing bootstrap/; graph loads also ensure pins.',
    )
}

/**
 * @typedef {object} PluginsEnsureArgv
 * @property {string[]} [dir]
 */

/**
 * @param {PluginsEnsureArgv} argv
 */
export async function handler(argv) {
  const dirs =
    Array.isArray(argv.dir) && argv.dir.length > 0
      ? argv.dir.map((d) => String(d))
      : [resolveBootstrapDir()]

  let any = false
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.error(`qctl plugins ensure: missing dir ${dir}`)
      process.exitCode = 1
      return
    }
    const { pins, cached } = await ensureNpmPluginsFromDir(dir)
    if (pins.length === 0) {
      console.log(`qctl plugins ensure: ${dir} — no @plugin pins`)
      continue
    }
    any = true
    for (let i = 0; i < pins.length; i++) {
      console.log(`qctl plugins ensure: ${pins[i].descriptor} → ${cached[i] || '(cached)'}`)
    }
  }
  if (!any) console.log('qctl plugins ensure: nothing to install')
}
