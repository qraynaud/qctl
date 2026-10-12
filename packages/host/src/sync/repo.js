/**
 * Push the instance working tree to the guest repo dir.
 * Default: rsync-like --delete (remove guest files absent from the archive),
 * while preserving excluded paths (.hg, …). Stray repo-root `.env` is deleted
 * (instance uses `.env.dev` / `.env.prod` via QCTL_ENV only).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, chalk } from 'zx'

import { shellQuote } from '../lib/shell-quote.js'
import { sftpPut, sshExecOk } from './ssh.js'

/** @import { Client } from 'ssh2' */

/** Directory names never copied / never deleted on the guest (find -prune). */
export const SYNC_TAR_EXCLUDE_DIRS = [
  '.hg',
  '.git',
  'node_modules',
  '.cursor',
  '.vscode',
  '.idea',
  'volumes',
  'restic-repo',
]

/**
 * File basenames never copied from the host, and never deleted on the guest
 * (`find -prune` only skips directories — these need `! -name`).
 * Note: repo-root `.env` is intentionally absent — not listed here so `--delete`
 * removes a stale guest `.env` left over from older layouts.
 */
export const SYNC_TAR_EXCLUDE_FILES = ['.env.host', '.env.host.local', 'build.env', '.DS_Store']

/** Extra tar --exclude only (not delete-protected): never upload a host `.env`. */
const SYNC_TAR_EXCLUDE_UPLOAD_ONLY = ['.env']

/** Paths never copied to the guest (tar --exclude). */
export const SYNC_TAR_EXCLUDES = [
  ...SYNC_TAR_EXCLUDE_DIRS,
  ...SYNC_TAR_EXCLUDE_FILES,
  ...SYNC_TAR_EXCLUDE_UPLOAD_ONLY,
]

/**
 * @param {string} localRoot
 * @param {string} archivePath
 * @returns {Promise<void>}
 */
export async function buildRepoArchive(localRoot, archivePath) {
  const excludes = SYNC_TAR_EXCLUDES.flatMap((e) => ['--exclude', e])
  const r = await $`tar -C ${localRoot} -czf ${archivePath} ${excludes} .`.nothrow()
  if (r.exitCode !== 0) {
    throw new Error(`tar failed: ${String(r.stderr || r.stdout).trim()}`)
  }
}

/**
 * Paths inside a sync archive, normalized to `./rel` (files + dirs, as tar lists them).
 * @param {string} archivePath
 * @returns {Promise<string[]>}
 */
export async function listArchivePaths(archivePath) {
  const r = await $`tar -tzf ${archivePath}`.nothrow()
  if (r.exitCode !== 0) {
    throw new Error(`tar -t failed: ${String(r.stderr || r.stdout).trim()}`)
  }
  /** @type {Set<string>} */
  const out = new Set()
  for (const line of String(r.stdout).split('\n')) {
    const raw = line.trim()
    if (!raw || raw === '.') continue
    // tar usually emits ./foo or foo/
    let p = raw.startsWith('./') ? raw : `./${raw}`
    // Drop trailing slash for set membership of dirs (we still keep the entry).
    if (p.length > 2 && p.endsWith('/')) p = p.slice(0, -1)
    out.add(p)
  }
  return [...out].sort()
}

/**
 * Remote bash: after extract, delete files/dirs under remoteDir that are not in the
 * manifest and not excluded (rsync --delete --exclude).
 * @param {{ dirs?: string[], files?: string[] }} [opts]
 * @returns {string} bash body (argv: remoteDir manifestPath)
 */
export function remoteDeleteScript(opts = {}) {
  const dirs = opts.dirs ?? SYNC_TAR_EXCLUDE_DIRS
  const files = opts.files ?? SYNC_TAR_EXCLUDE_FILES
  // -prune only affects directories; file basenames use ! -name.
  const prunes = dirs.map((e) => `-name ${shellQuote(e.replace(/^\.\//, ''))}`).join(' -o ')
  const notFiles = files.map((e) => `! -name ${shellQuote(e.replace(/^\.\//, ''))}`).join(' ')

  return `
set -euo pipefail
REMOTE_DIR=$1
MANIFEST=$2
cd "$REMOTE_DIR"
# Files: skip excluded trees (-prune) and protected basenames (! -name).
while IFS= read -r -d '' f; do
  rel="\${f#./}"
  key="./$rel"
  if ! grep -Fxq -- "$key" "$MANIFEST" 2>/dev/null; then
    rm -f -- "$f"
  fi
done < <(find . \\( ${prunes} \\) -prune -o -type f ${notFiles} -print0)

# Empty dirs (bottom-up), still respecting excluded trees.
while IFS= read -r -d '' d; do
  [[ "$d" == "." ]] && continue
  rel="\${d#./}"
  key="./$rel"
  if ! grep -Fxq -- "$key" "$MANIFEST" 2>/dev/null; then
    rmdir --ignore-fail-on-non-empty -- "$d" 2>/dev/null || true
  fi
done < <(find . \\( ${prunes} \\) -prune -o -type d -print0 | sort -rz)
`.trim()
}

/**
 * @param {Client} conn
 * @param {{
 *   localRoot: string
 *   remoteDir: string
 *   dryRun?: boolean
 *   delete?: boolean
 * }} opts
 */
export async function syncRepo(conn, opts) {
  const { localRoot, remoteDir, dryRun } = opts
  const doDelete = opts.delete !== false
  const stamp = `qctl-sync-${process.pid}-${Date.now()}`
  const remoteTar = `/tmp/${stamp}.tgz`
  const remoteManifest = `/tmp/${stamp}.manifest`
  const remoteScript = `/tmp/${stamp}-delete.sh`

  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] would archive ${localRoot} → ${remoteDir}`))
    console.log(chalk.dim(`  [dry-run] excludes: ${SYNC_TAR_EXCLUDES.join(', ')}`))
    console.log(chalk.dim(`  [dry-run] delete: ${doDelete ? 'yes' : 'no'}`))
    return
  }

  const tmp = await mkdtemp(join(tmpdir(), 'qctl-sync-'))
  const localTar = join(tmp, 'repo.tgz')
  const localManifest = join(tmp, 'manifest')
  const localScript = join(tmp, 'delete.sh')
  try {
    console.log(chalk.dim(`  archiving ${localRoot}…`))
    await buildRepoArchive(localRoot, localTar)
    const paths = await listArchivePaths(localTar)
    await writeFile(localManifest, `${paths.join('\n')}\n`, 'utf8')

    console.log(chalk.dim(`  upload → ${remoteTar}`))
    await sftpPut(conn, localTar, remoteTar)
    await sshExecOk(
      conn,
      `mkdir -p ${shellQuote(remoteDir)} && tar -C ${shellQuote(remoteDir)} -xzf ${shellQuote(remoteTar)} && rm -f ${shellQuote(remoteTar)}`,
    )

    if (doDelete) {
      await writeFile(localScript, `${remoteDeleteScript()}\n`, 'utf8')
      await sftpPut(conn, localManifest, remoteManifest)
      await sftpPut(conn, localScript, remoteScript)
      await sshExecOk(
        conn,
        `bash ${shellQuote(remoteScript)} ${shellQuote(remoteDir)} ${shellQuote(remoteManifest)}`
          + ` && rm -f ${shellQuote(remoteScript)} ${shellQuote(remoteManifest)}`,
      )
      console.log(chalk.green(`  repo → ${remoteDir} (with --delete)`))
    } else {
      console.log(chalk.green(`  repo → ${remoteDir}`))
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
