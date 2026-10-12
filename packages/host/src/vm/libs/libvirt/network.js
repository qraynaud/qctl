import { chalk } from 'zx'

import { HOST_DEPS, die } from '../../../lib/util.js'
import { virsh } from './virsh.js'

/**
 * @param {string} connect
 * @returns {Promise<void>}
 */
export async function ensureDefaultNetwork(connect) {
  if (connect.includes('session')) return
  const list = await virsh(connect, 'net-list', '--all').nothrow()
  if (list.exitCode !== 0) return
  const out = String(list.stdout)
  if (!/\bdefault\b/.test(out)) {
    die(`libvirt network 'default' is missing.\n\n${HOST_DEPS}`)
  }
  if (/^\s*default\s+active\b/m.test(out)) return
  console.log(chalk.cyan(`vm: starting libvirt network 'default'`))
  const start = await virsh(connect, 'net-start', 'default').nothrow()
  if (start.exitCode !== 0) {
    die(
      `could not start network 'default': ${String(start.stderr || start.stdout).trim()}\n\n${HOST_DEPS}`,
    )
  }
  await virsh(connect, 'net-autostart', 'default').nothrow()
}
