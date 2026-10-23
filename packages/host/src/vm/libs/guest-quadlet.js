/**
 * Guest `qctl quadlet …` over SSH (same endpoint as sync / vm shell).
 */
import { chalk } from 'zx'

import { shellQuote } from '../../lib/shell-quote.js'
import { sshExec, sshExecOk, withSsh } from '../../sync/ssh.js'

/** @import { SyncEndpoint } from '../../sync/endpoint.js' */
/** @import { SshClient } from '../../sync/ssh.js' */

/**
 * @param {SshClient} conn
 * @param {string} [app]
 * @returns {Promise<void>}
 */
async function ensureTankDirs(conn, app) {
  /** @type {string[]} */
  const dirs = ['/tank/rocky/volumes']
  if (app) {
    const base = `/tank/rocky/volumes/${app}`
    dirs.push(base, `${base}/config`, `${base}/data`)
  }
  await sshExecOk(
    conn,
    `sudo mkdir -p ${dirs.map(shellQuote).join(' ')}`
      + ' && sudo chown -R apps:apps /tank/rocky/volumes',
  )
}

/**
 * @param {SyncEndpoint} ep
 * @param {string[]} apps
 * @returns {Promise<void>}
 */
export async function guestQuadletUp(ep, apps) {
  const list = apps.map(String).filter(Boolean)
  if (!list.length) return
  console.log(chalk.cyan(`vm: quadlet up ${list.join(' ')}`), chalk.dim(`→ ${ep.label}`))
  await withSsh(
    {
      host: ep.host,
      port: ep.port,
      username: ep.username,
      identity: ep.identity,
    },
    async (conn) => {
      for (const app of list) await ensureTankDirs(conn, app)
      const root = shellQuote(ep.remoteDir || '/tank/rocky')
      await sshExecOk(conn, `qctl quadlet up --root ${root} ${list.map(shellQuote).join(' ')}`)
    },
  )
}

/**
 * Unfiltered `qctl quadlet up` (every app on the guest).
 * @param {SyncEndpoint} ep
 * @returns {Promise<void>}
 */
export async function guestQuadletUpAll(ep) {
  console.log(chalk.cyan('vm: quadlet up (all apps)'), chalk.dim(`→ ${ep.label}`))
  await withSsh(
    {
      host: ep.host,
      port: ep.port,
      username: ep.username,
      identity: ep.identity,
    },
    async (conn) => {
      await ensureTankDirs(conn)
      const root = shellQuote(ep.remoteDir || '/tank/rocky')
      await sshExecOk(conn, `qctl quadlet up --root ${root}`)
    },
  )
}

/**
 * @param {SyncEndpoint} ep
 * @param {string[]} apps
 * @returns {Promise<void>}
 */
export async function guestQuadletDown(ep, apps) {
  const list = apps.map(String).filter(Boolean)
  if (!list.length) return
  console.log(chalk.cyan(`vm: quadlet down ${list.join(' ')}`), chalk.dim(`→ ${ep.label}`))
  await withSsh(
    {
      host: ep.host,
      port: ep.port,
      username: ep.username,
      identity: ep.identity,
    },
    async (conn) => {
      const root = shellQuote(ep.remoteDir || '/tank/rocky')
      await sshExec(
        conn,
        `qctl quadlet down --root ${root} ${list.map(shellQuote).join(' ')} || true`,
      )
    },
  )
}

/**
 * Guest `qctl quadlet ps` (optional app filter). Prints remote stdout/stderr; does not throw on
 * non-zero exit (same as `qctl local ps`).
 *
 * @param {SyncEndpoint} ep
 * @param {string[]} [apps]
 * @returns {Promise<number>} remote exit code
 */
export async function guestQuadletPs(ep, apps = []) {
  const list = apps.map(String).filter(Boolean)
  const root = shellQuote(ep.remoteDir || '/tank/rocky')
  const cmd = list.length
    ? `qctl quadlet ps --root ${root} ${list.map(shellQuote).join(' ')}`
    : `qctl quadlet ps --root ${root}`
  /** @type {{ code: number, stdout: string, stderr: string }} */
  let r = { code: 1, stdout: '', stderr: '' }
  await withSsh(
    {
      host: ep.host,
      port: ep.port,
      username: ep.username,
      identity: ep.identity,
    },
    async (conn) => {
      r = await sshExec(conn, cmd)
    },
  )
  console.log(String(r.stdout).trimEnd() || chalk.dim('(no quadlet output)'))
  if (r.code !== 0 && r.stderr) {
    console.error(String(r.stderr).trimEnd())
  }
  return r.code
}
