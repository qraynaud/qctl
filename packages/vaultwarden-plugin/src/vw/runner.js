/** @import { StdioOptions } from 'node:child_process' */
/** @import { VwAccountId, VwCall } from './parse.js' */

const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')

const { DEFAULT_VW_ACCOUNT } = require('./parse.js')

/**
 * @typedef {object} RunResult
 * @property {number} code
 * @property {Buffer} stdout
 * @property {string} stderr
 */

/**
 * @typedef {object} RunOpts
 * @property {Record<string, string | undefined>} env
 * @property {StdioOptions} [stdio]
 * @property {boolean} [teeStderr]
 *   When stderr is piped, also write chunks to process.stderr live (prompts).
 */

/**
 * @typedef {(cmd: string, args: string[], opts: RunOpts) => Promise<RunResult>} Runner
 */

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {RunOpts} opts
 * @returns {Promise<RunResult>}
 */
function defaultRunner(cmd, args, opts) {
  const stdio = opts.stdio ?? ['ignore', 'pipe', 'pipe']
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: /** @type {NodeJS.ProcessEnv} */ (opts.env),
      stdio,
    })
    /** @type {Buffer[]} */
    const out = []
    /** @type {Buffer[]} */
    const err = []
    if (child.stdout) child.stdout.on('data', (d) => out.push(d))
    if (child.stderr) {
      child.stderr.on('data', (d) => {
        err.push(d)
        if (opts.teeStderr) process.stderr.write(d)
      })
    }
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      }),
    )
  })
}

/**
 * Stable string fragment for an account id (default Symbol → `"default"`).
 * @param {VwAccountId | undefined} accountId
 * @returns {string}
 */
function accountIdKey(accountId) {
  if (accountId == null || accountId === DEFAULT_VW_ACCOUNT) return 'default'
  return String(accountId)
}

/**
 * Cache key for a bw apodata dir + account (same idea as official `bwp-session:`).
 * @param {string | undefined} appDataDir
 * @param {VwAccountId | undefined} [accountId]
 * @returns {string}
 */
function sessionCacheKey(appDataDir, accountId) {
  const idPart = accountIdKey(accountId)
  if (!appDataDir) return `vw-session:${idPart}`
  const dirPart = createHash('sha256').update(appDataDir).digest('hex').slice(0, 12)
  return `vw-session:${idPart}:${dirPart}`
}

/**
 * Account key fragment shared by session + value cache keys.
 * @param {string | undefined} appDataDir
 * @param {VwAccountId | undefined} [accountId]
 * @returns {string}
 */
function accountKey(appDataDir, accountId) {
  return sessionCacheKey(appDataDir, accountId).replace(/^vw-session:/, '')
}

/**
 * Value-cache key for a resolved `vw()` call (official `bwp:{acct}:{item}:{field}` shape).
 * @param {string | undefined} appDataDir
 * @param {VwCall} call
 * @returns {string}
 */
function valueCacheKey(appDataDir, call) {
  const acct = accountKey(appDataDir, call.accountId)
  if (call.kind === 'attachment') {
    return `vw:${acct}:${call.item}:att:${call.file}:${call.encoding}`
  }
  return `vw:${acct}:${call.item}:field:${call.field}`
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errText(err) {
  return (err instanceof Error ? err.message : String(err)).toLowerCase()
}

/**
 * CLI account is logged out (`bw logout` / never logged in) — needs `bw login`, not just unlock.
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotLoggedInError(err) {
  const msg = errText(err)
  return msg.includes('not logged in') || msg.includes('unauthenticated')
}

/**
 * Whether a bw CLI error looks like a dead/locked session (self-heal candidate).
 * Wrong master password (crypto/decryption) is intentionally excluded — that is not a stale session.
 * @param {unknown} err
 * @returns {boolean}
 */
function isInvalidSessionError(err) {
  const msg = errText(err)
  return (
    isNotLoggedInError(err)
    || msg.includes('vault is locked')
    || msg.includes('is locked')
    || (msg.includes('session')
      && (msg.includes('invalid') || msg.includes('expired') || msg.includes('locked')))
  )
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isBadPasswordText(text) {
  const t = text.toLowerCase()
  return (
    t.includes('decryption operation failed')
    || t.includes('cryptography error')
    || t.includes('invalid master password')
    || t.includes('password is incorrect')
    || t.includes('mac failed')
  )
}

/**
 * @param {string} stderr
 * @param {number} code
 * @returns {string}
 */
function formatUnlockError(stderr, code) {
  const text = (stderr || '').trim()
  if (isBadPasswordText(text)) return 'bw unlock failed: invalid master password'
  return `bw unlock failed: ${text || `exit ${code}`}`
}

module.exports = {
  defaultRunner,
  accountIdKey,
  sessionCacheKey,
  accountKey,
  valueCacheKey,
  isNotLoggedInError,
  isInvalidSessionError,
  isBadPasswordText,
  formatUnlockError,
}
