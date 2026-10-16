/**
 * Interactive gate for destructive `vm destroy` on a production env.
 */
import { createInterface } from 'node:readline'

import { chalk } from 'zx'

import { die } from '../../lib/util.js'

/**
 * Full wipe on production must be confirmed on a TTY by typing the VM name.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function confirmProdFullDestroy(name) {
  const label = String(name || '').trim()
  if (!label) die('destroy: VM name required for production confirmation')

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    die(
      'destroy: production full wipe requires an interactive TTY\n'
        + '  (use --keep-persistent to drop OS only, or run from a terminal)',
    )
  }

  console.log(
    chalk.yellow(
      `vm: production full destroy will DELETE the OS disk and all persistent disks for ${label}`,
    ),
  )
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise((resolve) => {
      rl.question(`Type the VM name (${label}) to confirm: `, resolve)
    })
    if (String(answer).trim() !== label) {
      die('destroy: confirmation mismatch — aborted')
    }
  } finally {
    rl.close()
  }
}
