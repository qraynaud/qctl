/**
 * Push guest/platform release binaries (and optional bootstrap) onto the appliance.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, chalk, path } from 'zx'

import { ensureGuestTooling } from '../vm/libs/guest-tooling.js'
import { tryGetRepoRoot } from '../vm/libs/paths.js'
import { sftpPut, sshExecOk } from './ssh.js'

/** @import { Client } from 'ssh2' */

/**
 * @typedef {{ local: string, remoteTmp: string, installAs: string, mode: string }} ToolingFile
 */

/**
 * Resolve qctl-guest → /usr/local/bin/qctl and selected platform module (GitHub or env).
 * @param {{
 *   platformModule?: string,
 *   env?: string,
 *   target?: string,
 *   platform?: string,
 * }} [opts]
 * @returns {Promise<{ files: ToolingFile[], bootstrapDir: string | null, sourceLabel: string }>}
 */
export async function resolveGuestToolingForSync(opts = {}) {
  const resolved = await ensureGuestTooling({
    env: opts.env,
    target: opts.target,
    platform: opts.platform,
    platformModule: opts.platformModule,
    required: true,
  })
  if (!resolved) {
    throw new Error(
      'sync --include-tooling: no guest binaries.\n'
        + '  Need a GitHub release (or set QCTL_GUEST_DIST / QCTL_PLATFORM_MODULE).',
    )
  }

  const stamp = `qctl-tooling-${process.pid}`
  /** @type {ToolingFile[]} */
  const files = [
    {
      local: resolved.guestPath,
      remoteTmp: `/tmp/${stamp}-qctl-guest`,
      installAs: '/usr/local/bin/qctl',
      mode: '0755',
    },
    {
      local: resolved.platformModulePath,
      remoteTmp: `/tmp/${stamp}-${resolved.platformModule}`,
      installAs: `/usr/local/lib/qctl/${resolved.platformModule}`,
      mode: '0644',
    },
  ]
  if (resolved.encryptPath) {
    files.push({
      local: resolved.encryptPath,
      remoteTmp: `/tmp/${stamp}-varlock-local-encrypt`,
      installAs: '/usr/local/bin/varlock-local-encrypt',
      mode: '0755',
    })
  }

  /** @type {string | null} */
  let bootstrapDir = null
  const root = tryGetRepoRoot()
  if (root) {
    const boot = path.join(root, 'bootstrap')
    if (existsSync(path.join(boot, '.env.schema'))) bootstrapDir = boot
  }

  return { files, bootstrapDir, sourceLabel: resolved.sourceLabel }
}

/**
 * @param {string} s
 */
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * @param {Client} conn
 * @param {{ dryRun?: boolean, env?: string, target?: string }} [opts]
 */
export async function syncTooling(conn, opts = {}) {
  const { files, bootstrapDir, sourceLabel } = await resolveGuestToolingForSync({
    env: opts.env,
    target: opts.target,
  })
  console.log(chalk.dim(`  tooling ← ${sourceLabel}`))

  if (opts.dryRun) {
    for (const f of files) {
      console.log(chalk.dim(`  [dry-run] ${f.local} → ${f.installAs}`))
    }
    if (bootstrapDir) {
      console.log(chalk.dim(`  [dry-run] ${bootstrapDir}/ → /usr/local/lib/qctl/bootstrap/`))
    }
    return
  }

  for (const f of files) {
    await sftpPut(conn, f.local, f.remoteTmp)
    const parent = path.posix.dirname(f.installAs)
    let cmd =
      `sudo mkdir -p ${shellQuote(parent)}`
      + ` && sudo install -m ${f.mode} ${shellQuote(f.remoteTmp)} ${shellQuote(f.installAs)}`
      + ` && rm -f ${shellQuote(f.remoteTmp)}`
    if (f.installAs.endsWith('.mjs')) {
      cmd +=
        ` && printf 'QCTL_PLATFORM_MODULE=%s\\n' ${shellQuote(f.installAs)}`
        + ` | sudo tee /etc/environment.d/90-qctl-platform.conf >/dev/null`
    }
    await sshExecOk(conn, cmd)
    console.log(chalk.green(`  ${f.installAs}`))
  }

  if (bootstrapDir) {
    const tmp = await mkdtemp(join(tmpdir(), 'qctl-boot-'))
    try {
      const tar = join(tmp, 'bootstrap.tgz')
      const r = await $`tar -C ${bootstrapDir} -czf ${tar} .`.nothrow()
      if (r.exitCode !== 0) {
        throw new Error(`bootstrap tar failed: ${String(r.stderr || r.stdout).trim()}`)
      }
      const remoteTar = `/tmp/qctl-bootstrap-${process.pid}.tgz`
      await sftpPut(conn, tar, remoteTar)
      await sshExecOk(
        conn,
        `sudo mkdir -p /usr/local/lib/qctl/bootstrap`
          + ` && sudo tar -C /usr/local/lib/qctl/bootstrap -xzf ${shellQuote(remoteTar)}`
          + ` && sudo rm -f ${shellQuote(remoteTar)}`,
      )
      console.log(chalk.green('  /usr/local/lib/qctl/bootstrap/'))
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
}
