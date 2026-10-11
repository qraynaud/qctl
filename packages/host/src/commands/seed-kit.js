/**
 * Expose the Rocky seed kit (cloud-init / first-boot / lib) for `qctl vm seed`.
 *
 * Inside a compiled binary the kit is Bun `--asset` embedded (`$bunfs`). Host
 * processes outside that binary cannot read that path, so `path` materializes
 * to a real directory when needed and `export` always copies onto a normal FS.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** @import { Argv } from 'yargs' */

import { copySeedKit } from '../seed-fs.js'
import { getRockySeedRoot, isEmbeddedSeedRoot } from '../seed-root.js'

export const command = 'seed-kit'
export const describe =
  'Print or export the Rocky seed kit (cloud-init / first-boot / lib) for qctl vm seed'

/** Parent command — subcommands do the work. */
export function handler() {}

/**
 * Host-visible seed root. Embedded `$bunfs` kits are copied to a temp dir.
 * @returns {string}
 */
function hostVisibleSeedRoot() {
  const src = getRockySeedRoot()
  if (!isEmbeddedSeedRoot(src)) return src

  const dest = mkdtempSync(join(tmpdir(), 'qctl-rocky-seed-'))
  try {
    copySeedKit(src, dest)
  } catch (err) {
    try {
      rmSync(dest, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw err
  }
  return dest
}

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .command(
      'path',
      'Print a host-readable seed-kit root (must contain cloud-init/user-data.yaml)',
      () => {},
      () => {
        process.stdout.write(`${hostVisibleSeedRoot()}\n`)
      },
    )
    .command(
      'export <dir>',
      'Copy the seed kit into <dir> (creates cloud-init/, first-boot/, lib/)',
      (y) =>
        y.positional('dir', {
          type: 'string',
          describe: 'Destination directory',
          demandOption: true,
        }),
      (argv) => {
        const src = getRockySeedRoot()
        const dest = String(argv.dir)
        copySeedKit(src, dest)
        console.log(`exported seed kit → ${dest}`)
      },
    )
    .demandCommand(1)
    .strictCommands()
}
