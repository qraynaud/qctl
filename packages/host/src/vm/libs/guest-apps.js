/**
 * Resolve app list for `vm up` / `vm down` positionals + `--all`.
 */
import { tryGetRepoRoot } from '../../lib/paths.js'
import { die } from '../../lib/util.js'
import { listInstanceApps } from '../../local/apps.js'

/**
 * @param {{ apps?: string[], all?: boolean }} argv
 * @returns {{ mode: 'none' } | { mode: 'all', apps: string[] } | { mode: 'list', apps: string[] }}
 */
export function resolveVmAppSelection(argv) {
  const apps = (argv.apps ?? []).map(String).filter(Boolean)
  if (argv.all) {
    if (apps.length) die('pass either --all or app names, not both')
    const root = tryGetRepoRoot()
    if (!root) {
      die(
        'not inside a qctl instance repo (no provision/*.yaml with a qctl: block).\n'
          + '  Run `qctl init <dir>` or cd into an existing instance.',
      )
    }
    const discovered = listInstanceApps(root)
    if (!discovered.length) die('no applications/*/app.yaml found')
    return { mode: 'all', apps: discovered }
  }
  if (!apps.length) return { mode: 'none' }
  return { mode: 'list', apps }
}
