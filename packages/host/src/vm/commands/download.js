import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

import { $, chalk, fs, path } from 'zx'

import { IMAGE } from '../../cloud-image.js'
import { getImages } from '../../lib/paths.js'
import { die, requireBins } from '../../lib/util.js'
import { gcQctlCache, touchPath } from '../../tooling/cache-gc.js'
import { ensureCloudImage } from '../../tooling/platform-tooling.js'

/** @import { Argv } from 'yargs' */
/** @import { RockyCloudImage } from '../../cloud-image.js' */
/** @import { VmArgv } from '../types.js' */

export { IMAGE }

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * @param {{ force?: boolean, env?: string, target?: string }} opts
 * @returns {Promise<string>}
 */
export async function downloadImage({ force, env, target }) {
  /** @type {RockyCloudImage} */
  const image = await ensureCloudImage({ env, target })
  const images = getImages()
  await fs.mkdirp(images)
  const dest = path.join(images, image.file)
  if (fs.existsSync(dest) && !force) {
    const got = await sha256File(dest)
    if (got === image.sha256) {
      touchPath(dest)
      console.log(chalk.green(`vm: image OK ${dest}`))
      return dest
    }
    console.warn(chalk.yellow(`vm: checksum mismatch, re-downloading`))
  }

  await requireBins(['curl'])
  const partial = `${dest}.partial`
  console.log(chalk.cyan(`vm: downloading ${image.url}`))
  const r = await $`curl -fL --progress-bar -o ${partial} ${image.url}`.nothrow()
  if (r.exitCode !== 0) {
    await fs.remove(partial).catch(() => {})
    die(`download failed (curl exit ${r.exitCode})`)
  }
  const got = await sha256File(partial)
  if (got !== image.sha256) {
    await fs.remove(partial).catch(() => {})
    die(`SHA256 mismatch:\n  expected ${image.sha256}\n  got      ${got}`)
  }
  await fs.move(partial, dest, { overwrite: true })
  touchPath(dest)
  gcQctlCache()
  console.log(chalk.green(`vm: cached ${dest}`))
  return dest
}

export const command = 'download'
export const describe = 'Download/cache the pinned Rocky 9 cloud qcow2'

/**
 * @param {Argv} yargs
 * @returns {Argv}
 */
export function builder(yargs) {
  return yargs
    .option('force-download', {
      type: 'boolean',
      default: false,
      describe: 'Re-download even if cached checksum matches',
    })
    .strict()
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function handler(argv) {
  await downloadImage({
    force: argv.forceDownload,
    env: String(argv.env || 'dev'),
    target: String(argv.target || 'local'),
  })
}
