/**
 * Push compiled guest/platform binaries (and optional bootstrap) onto the appliance.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, chalk, path } from 'zx'

import { loadEnvSecretsOrThrow } from '../vm/libs/load-config.js'
import { tryGetRepoRoot } from '../vm/libs/paths.js'
import { parsePlatformRef } from '../vm/libs/platform-ref.js'
import { sftpPut, sshExecOk } from './ssh.js'

/** @import { Client } from 'ssh2' */

/**
 * @returns {string[]}
 */
function guestToolingDistDirs() {
  /** @type {string[]} */
  const dirs = []
  if (process.env.QCTL_GUEST_DIST) dirs.push(path.resolve(process.env.QCTL_GUEST_DIST))
  const root = tryGetRepoRoot()
  if (root) dirs.push(path.resolve(root, '..', 'qctl', 'dist'))
  return dirs
}

/**
 * @typedef {{ local: string, remoteTmp: string, installAs: string, mode: string }} ToolingFile
 */

/**
 * Resolve qctl-guest → /usr/local/bin/qctl and selected platform module from dist / env.
 * @param {{ platformModule?: string }} [opts]
 * @returns {{ files: ToolingFile[], bootstrapDir: string | null, distDir: string }}
 */
export function resolveGuestToolingForSync(opts = {}) {
  const platformModule = opts.platformModule || parsePlatformRef('rocky').moduleFile
  const names = ['qctl-guest', platformModule]
  /** @type {string | null} */
  let distDir = null
  for (const dir of guestToolingDistDirs()) {
    if (names.every((n) => existsSync(path.join(dir, n)))) {
      distDir = dir
      break
    }
  }
  if (!distDir) {
    throw new Error(
      'sync --include-tooling: no compiled guest binaries.\n'
        + '  Run `bun run compile` in the qctl checkout, or set QCTL_GUEST_DIST.',
    )
  }

  const stamp = `qctl-tooling-${process.pid}`
  /** @type {ToolingFile[]} */
  const files = [
    {
      local: path.join(distDir, 'qctl-guest'),
      remoteTmp: `/tmp/${stamp}-qctl-guest`,
      installAs: '/usr/local/bin/qctl',
      mode: '0755',
    },
    {
      local: path.join(distDir, platformModule),
      remoteTmp: `/tmp/${stamp}-${platformModule}`,
      installAs: `/usr/local/lib/qctl/${platformModule}`,
      mode: '0644',
    },
  ]
  const encrypt = path.join(distDir, 'varlock-local-encrypt')
  if (existsSync(encrypt)) {
    files.push({
      local: encrypt,
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

  return { files, bootstrapDir, distDir }
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
  let platformModule = parsePlatformRef('rocky').moduleFile
  try {
    const sec = await loadEnvSecretsOrThrow({
      env: opts.env || 'dev',
      target: opts.target || 'local',
    })
    platformModule = parsePlatformRef(sec.platform).moduleFile
  } catch {
    // default rocky
  }
  const { files, bootstrapDir, distDir } = resolveGuestToolingForSync({ platformModule })
  console.log(chalk.dim(`  tooling ← ${distDir}`))

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
