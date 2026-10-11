/**
 * Download a GitHub release asset into the tooling cache.
 */
import { existsSync } from 'node:fs'

import { $, chalk, fs, path } from 'zx'

import { die } from './util.js'

/**
 * @param {{
 *   githubRepo: string,
 *   version: string,
 *   name: string,
 *   dest: string,
 *   required?: boolean,
 * }} opts
 * @returns {Promise<string | null>} dest path, or null when `required: false` and download fails
 */
export async function downloadGithubReleaseAsset(opts) {
  const version = String(opts.version).replace(/^v/, '')
  const url = `https://github.com/${opts.githubRepo}/releases/download/v${version}/${opts.name}`
  await fs.mkdirp(path.dirname(opts.dest))
  console.log(chalk.cyan(`vm: downloading ${opts.name} v${version} ← ${opts.githubRepo}`))
  const r = await $`curl -fsSL -o ${opts.dest} ${url}`.nothrow()
  if (r.exitCode !== 0 || !existsSync(opts.dest)) {
    await fs.remove(opts.dest).catch(() => {})
    if (opts.required === false) return null
    die(
      `failed to download ${url}\n`
        + `  Set QCTL_GUEST_DIST / QCTL_PLATFORM_MODULE for a local override,`
        + ` or publish release assets matching compile output.`,
    )
  }
  console.log(chalk.dim(`  ${opts.name}: ${opts.dest} ← ${url}`))
  return opts.dest
}
