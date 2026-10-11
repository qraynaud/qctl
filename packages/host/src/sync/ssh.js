/**
 * Thin ssh2 helpers for `qctl sync` (SFTP + exec). Prefer this over shelling out
 * to OpenSSH so transfers and remote commands share one authenticated session.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Client } from 'ssh2'

/** @import { SFTPWrapper } from 'ssh2' */

/**
 * @typedef {object} SshConnectOpts
 * @property {string} host
 * @property {number} port
 * @property {string} username
 * @property {string} [identity] private key path
 * @property {number} [readyTimeoutMs]
 */

/** @typedef {InstanceType<typeof Client>} SshClient */

const KEY_CANDIDATES = ['id_ed25519', 'id_rsa', 'id_ecdsa']

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isEncryptedKey(buf) {
  const s = buf.toString('utf8')
  return s.includes('ENCRYPTED') || /Proc-Type:\s*4,ENCRYPTED/i.test(s)
}

/**
 * Prefer ssh-agent (handles encrypted keys). Fall back to an unencrypted key file.
 * @param {string} [identity]
 * @returns {{ privateKey?: Buffer | string, agent?: string }}
 */
export function sshAuthFromIdentity(identity) {
  const agent = process.env.SSH_AUTH_SOCK?.trim()

  if (identity) {
    const privateKey = readFileSync(identity)
    if (isEncryptedKey(privateKey) && !agent) {
      throw new Error(
        `SSH key ${identity} is encrypted — unlock it in ssh-agent, or pass an unencrypted --identity`,
      )
    }
    /** @type {{ privateKey?: Buffer | string, agent?: string }} */
    const out = {}
    // Agent first when the key is encrypted (ssh2 cannot prompt for a passphrase).
    if (agent && isEncryptedKey(privateKey)) out.agent = agent
    else {
      out.privateKey = privateKey
      if (agent) out.agent = agent
    }
    return out
  }

  if (agent) return { agent }

  for (const name of KEY_CANDIDATES) {
    const p = join(homedir(), '.ssh', name)
    try {
      const privateKey = readFileSync(p)
      if (isEncryptedKey(privateKey)) continue
      return { privateKey }
    } catch {
      /* try next */
    }
  }

  throw new Error(
    'no SSH identity: start ssh-agent (ssh-add), set --identity to an unencrypted key, '
      + 'or place ~/.ssh/id_ed25519 (unencrypted)',
  )
}

/**
 * @param {SshConnectOpts} opts
 * @returns {Promise<SshClient>}
 */
export function sshConnect(opts) {
  const auth = sshAuthFromIdentity(opts.identity)
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        readyTimeout: opts.readyTimeoutMs ?? 20_000,
        // Lab VMs rotate host keys across wipe-os; accept first seen like deploy_key config.
        hostVerifier: () => true,
        ...auth,
      })
  })
}

/**
 * @param {SshClient} conn
 * @param {string} command
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function sshExec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (/** @type {Error | undefined | null} */ err, stream) => {
      if (err) {
        reject(err)
        return
      }
      let stdout = ''
      let stderr = ''
      stream
        .on('close', (/** @type {number | null} */ code) => {
          resolve({ code: code ?? 0, stdout, stderr })
        })
        .on('data', (/** @type {Buffer | string} */ d) => {
          stdout += String(d)
        })
      stream.stderr.on('data', (/** @type {Buffer | string} */ d) => {
        stderr += String(d)
      })
    })
  })
}

/**
 * @param {SshClient} conn
 * @param {string} command
 * @returns {Promise<void>}
 */
export async function sshExecOk(conn, command) {
  const r = await sshExec(conn, command)
  if (r.code !== 0) {
    throw new Error(
      `remote command failed (exit ${r.code}): ${command}\n${(r.stderr || r.stdout).trim()}`,
    )
  }
}

/**
 * @param {SshClient} conn
 * @returns {Promise<SFTPWrapper>}
 */
export function sshSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((/** @type {Error | undefined | null} */ err, sftp) =>
      err ? reject(err) : resolve(sftp),
    )
  })
}

/**
 * @param {SshClient} conn
 * @param {string} localPath
 * @param {string} remotePath
 * @returns {Promise<void>}
 */
export async function sftpPut(conn, localPath, remotePath) {
  const sftp = await sshSftp(conn)
  await new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (/** @type {Error | null | undefined} */ err) =>
      err ? reject(err) : resolve(undefined),
    )
  })
}

/**
 * @param {SshConnectOpts} opts
 * @param {(conn: SshClient) => Promise<void>} fn
 */
export async function withSsh(opts, fn) {
  const conn = await sshConnect(opts)
  try {
    await fn(conn)
  } finally {
    conn.end()
  }
}
