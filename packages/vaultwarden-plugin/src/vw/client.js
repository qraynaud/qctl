/** @import { BwItem } from './items.js' */
/** @import { VwAccountId } from './parse.js' */
/** @import { Runner, RunOpts, RunResult } from './runner.js' */

const { extractItemField, pickAttachment } = require('./items.js')
const { DEFAULT_VW_ACCOUNT } = require('./parse.js')
const {
  defaultRunner,
  formatUnlockError,
  isInvalidSessionError,
  isNotLoggedInError,
  sessionCacheKey,
} = require('./runner.js')

/**
 * @typedef {{
 *   status?: 'unauthenticated' | 'locked' | 'unlocked' | string,
 *   userEmail?: string | null,
 *   serverUrl?: string | null,
 *   lastSync?: string | null,
 * }} BwStatus
 */

const DEFAULT_SYNC_TTL_MS = 5 * 60 * 1000

/**
 * `syncTtl` → ms window, or `null` to skip sync (`forever`).
 * @param {string | number | undefined} ttl
 * @returns {number | null}
 */
function syncTtlToMs(ttl) {
  if (ttl === undefined) return DEFAULT_SYNC_TTL_MS
  if (ttl === 'forever') return null
  if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) return ttl
  if (typeof ttl === 'string') {
    const t = ttl.trim().toLowerCase()
    if (t === 'forever') return null
  }
  return DEFAULT_SYNC_TTL_MS
}

/**
 * Minimal cache surface (varlock `plugin.cache`).
 * @typedef {{
 *   getOrSet: (
 *     key: string,
 *     ttl: string | number,
 *     producer: () => Promise<string>,
 *   ) => Promise<string>,
 *   set: (key: string, value: string, ttl: string | number) => Promise<void>,
 * }} SessionCache
 */

/**
 * @typedef {object} VwClientOptions
 * @property {VwAccountId} [accountId]
 *   Multi-account key (`@initVw(id=…)` or default Symbol).
 * @property {string} [appDataDir]
 *   Set as BITWARDENCLI_APPDATA_DIR for spawned `bw` only.
 * @property {string} [sessionToken]
 *   Pre-obtained CLI session (`bw unlock --raw`), e.g. `$BW_SESSION`.
 * @property {string} [masterPassword]  Non-interactive unlock via `--passwordenv`.
 * @property {string} [serverUrl]
 *   `bw config server <url>` before login (Vaultwarden / self-host).
 * @property {string} [clientId]
 *   Personal API key client_id (`BW_CLIENTID`) for `bw login --apikey`.
 * @property {string} [clientSecret]
 *   Personal API key client_secret (`BW_CLIENTSECRET`).
 * @property {string | number} [sessionTtl]
 *   Auto-unlock session cache TTL (default `"forever"`).
 * @property {string | number} [cacheTtl]
 *   Cache resolved `vw()` values (optional; like `@initBwp(cacheTtl=)`).
 * @property {string | number} [syncTtl]
 *   Skip `bw sync` when `bw status.lastSync` is newer than this (default `"5m"`).
 *   `"forever"` disables sync entirely.
 * @property {SessionCache} [cache]  varlock `plugin.cache` (optional).
 * @property {() => boolean} [isTTY]  Override TTY check (tests).
 * @property {string} [bin]  `bw` executable (default `bw`).
 * @property {Runner} [runner]
 * @property {Record<string, string | undefined>} [env]
 *   Base env for child (default process.env).
 */

class VwClient {
  /** @param {VwClientOptions} [opts] */
  constructor(opts = {}) {
    this.opts = opts
    /** @type {VwAccountId} */
    this.accountId = opts.accountId ?? DEFAULT_VW_ACCOUNT
    this.bin = opts.bin ?? 'bw'
    this.runner = opts.runner ?? defaultRunner
    this.baseEnv = opts.env ?? process.env
    this.sessionTtl = opts.sessionTtl ?? 'forever'
    /** @type {string | number | undefined} */
    this.cacheTtl = opts.cacheTtl
    /** @type {number | null} ms window, or null to never sync */
    this.syncTtlMs = syncTtlToMs(opts.syncTtl)
    this.cacheKey = sessionCacheKey(opts.appDataDir, this.accountId)
    /** @type {string | undefined} */
    this._session = undefined
    /** Manual token — no interactive unlock / no self-heal re-unlock. */
    this._manual = Boolean(opts.sessionToken?.trim() || this.baseEnv.BW_SESSION?.trim())
    /** @type {Promise<string> | undefined} */
    this._unlockInFlight = undefined
    /** @type {Promise<void> | undefined} */
    this._syncInFlight = undefined
    this._syncDone = false
    /** @type {Map<string, Promise<BwItem>>} */
    this._items = new Map()
  }

  /**
   * Child env: BITWARDENCLI_APPDATA_DIR only here — never mutates process.env.
   * @param {string | undefined} [session]
   * @returns {Record<string, string | undefined>}
   */
  childEnv(session) {
    /** @type {Record<string, string | undefined>} */
    const env = { ...this.baseEnv }
    if (this.opts.appDataDir) env.BITWARDENCLI_APPDATA_DIR = this.opts.appDataDir
    if (session) env.BW_SESSION = session
    return env
  }

  /**
   * @param {string[]} args
   * @param {string | undefined} [session]
   * @param {Pick<RunOpts, 'stdio'>} [runOpts]
   * @returns {Promise<RunResult>}
   */
  async run(args, session, runOpts = {}) {
    const res = await this.runner(this.bin, args, {
      env: this.childEnv(session),
      stdio: runOpts.stdio,
    })
    if (res.code !== 0) {
      throw new Error(
        `bw ${args[0] ?? ''} failed (exit ${res.code}): ${res.stderr.trim() || 'no stderr'}`,
      )
    }
    return res
  }

  /** @returns {boolean} */
  isTTY() {
    return (this.opts.isTTY ?? (() => Boolean(process.stdin.isTTY)))()
  }

  /**
   * Resolve a session token: manual → env → cached auto-unlock → interactive/master unlock.
   * @returns {Promise<string>}
   */
  async session() {
    if (this._session) return this._session
    if (this.opts.sessionToken?.trim()) {
      this._session = this.opts.sessionToken.trim()
      return this._session
    }
    if (this.baseEnv.BW_SESSION?.trim()) {
      this._session = this.baseEnv.BW_SESSION.trim()
      return this._session
    }
    this._session = await this.autoUnlock()
    return this._session
  }

  /**
   * @returns {Promise<string>}
   */
  async autoUnlock() {
    if (this._unlockInFlight) return this._unlockInFlight
    this._unlockInFlight = (async () => {
      const cache = this.opts.cache
      if (cache) {
        return await cache.getOrSet(this.cacheKey, this.sessionTtl, () => this.unlock())
      }
      return await this.unlock()
    })()
    try {
      return await this._unlockInFlight
    } finally {
      this._unlockInFlight = undefined
    }
  }

  /**
   * `bw status` JSON (serverUrl, status: unauthenticated|locked|unlocked, …).
   * @returns {Promise<BwStatus>}
   */
  async status() {
    const res = await this.runner(this.bin, ['status'], {
      env: this.childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (res.code !== 0) {
      throw new Error(`bw status failed: ${res.stderr.trim() || `exit ${res.code}`}`)
    }
    try {
      return /** @type {BwStatus} */ (JSON.parse(res.stdout.toString('utf8') || '{}'))
    } catch {
      throw new Error('bw status returned invalid JSON')
    }
  }

  /**
   * Apply `@initVw(serverUrl=…)` via `bw config server` when needed.
   * Only while unauthenticated — `bw` rejects server changes when logged in.
   * @param {BwStatus} [st]
   * @returns {Promise<void>}
   */
  async ensureServer(st) {
    const url = this.opts.serverUrl?.trim()
    if (!url) return
    if (st && st.status !== 'unauthenticated') return
    const want = url.replace(/\/+$/, '')
    const have = (st?.serverUrl ?? '').replace(/\/+$/, '')
    if (have && have === want) return
    const res = await this.runner(this.bin, ['config', 'server', url], {
      env: this.childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (res.code !== 0) {
      throw new Error(`bw config server failed: ${res.stderr.trim() || `exit ${res.code}`}`)
    }
  }

  /**
   * `bw login` — API key (`clientId`+`clientSecret`) or interactive (TTY).
   * Email/password login with `--raw` returns a session token (skip unlock).
   * API-key login does not — caller must unlock afterward.
   * @returns {Promise<string | undefined>}
   */
  async login() {
    if (this.opts.clientId && this.opts.clientSecret) {
      const env = this.childEnv()
      env.BW_CLIENTID = this.opts.clientId
      env.BW_CLIENTSECRET = this.opts.clientSecret
      const res = await this.runner(this.bin, ['login', '--apikey'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (res.code !== 0) {
        throw new Error(`bw login --apikey failed: ${res.stderr.trim() || `exit ${res.code}`}`)
      }
      return undefined
    }
    if (!this.isTTY()) {
      throw new Error(
        'Not logged in to Bitwarden/Vaultwarden. '
          + 'Pass clientId=+clientSecret= for `bw login --apikey`, or run once in a terminal for interactive login'
          + (this.opts.serverUrl ? '' : ' (set serverUrl= for self-hosted Vaultwarden)'),
      )
    }
    // --raw: session on stdout only (no "export BW_SESSION=…" dump). Prompts on stderr.
    const res = await this.runner(this.bin, ['login', '--raw'], {
      env: this.childEnv(),
      stdio: ['inherit', 'pipe', 'pipe'],
      teeStderr: true,
    })
    if (res.code !== 0) {
      throw new Error(`bw login failed: ${res.stderr.trim() || `exit ${res.code}`}`)
    }
    const token = res.stdout.toString('utf8').trim()
    return token || undefined
  }

  /**
   * Login when unauthenticated (configures `serverUrl` first if needed).
   * Skips `bw config server` when already logged in — CLI requires logout to change server.
   * @returns {Promise<string | undefined>} Session from email/password `login --raw`, if any.
   */
  async ensureLoggedIn() {
    const st = await this.status()
    if (st.status !== 'unauthenticated') return undefined
    await this.ensureServer(st)
    return await this.login()
  }

  /**
   * Unlock via `--passwordenv` (non-interactive / `masterPassword=`).
   * @param {string} password
   * @returns {Promise<string>}
   */
  async unlockWithPassword(password) {
    const env = this.childEnv()
    env.QCTL_VW_MASTER = password
    const res = await this.runner(
      this.bin,
      ['unlock', '--passwordenv', 'QCTL_VW_MASTER', '--raw'],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    if (res.code !== 0) {
      throw new Error(formatUnlockError(res.stderr, res.code))
    }
    const token = res.stdout.toString('utf8').trim()
    if (!token) throw new Error('bw unlock returned an empty session token')
    return token
  }

  /**
   * Interactive `bw unlock --raw` — stdin inherited for prompts; stderr piped +
   * teed so we can still classify failures (bad password, etc.).
   * @returns {Promise<string>}
   */
  async unlockInteractive() {
    const res = await this.runner(this.bin, ['unlock', '--raw'], {
      env: this.childEnv(),
      stdio: ['inherit', 'pipe', 'pipe'],
      teeStderr: true,
    })
    if (res.code !== 0) {
      throw new Error(formatUnlockError(res.stderr, res.code))
    }
    const token = res.stdout.toString('utf8').trim()
    if (!token) throw new Error('bw unlock returned an empty session token')
    return token
  }

  /**
   * Ensure login, then unlock — interactive `bw unlock --raw` on TTY, or
   * `--passwordenv` when masterPassword is set. Skips unlock when interactive
   * `bw login --raw` already returned a session.
   * @returns {Promise<string>}
   */
  async unlock() {
    const fromLogin = await this.ensureLoggedIn()
    if (fromLogin) return fromLogin
    if (this.opts.masterPassword) {
      return await this.unlockWithPassword(this.opts.masterPassword)
    }
    if (!this.isTTY()) {
      throw new Error(
        'Cannot unlock Vaultwarden interactively without a TTY. '
          + 'Pass sessionToken=$BW_SESSION or masterPassword=…, or run once in a terminal so the session can be cached.',
      )
    }
    return await this.unlockInteractive()
  }

  /**
   * Re-unlock after a stale cached session (official self-heal).
   * @returns {Promise<string>}
   */
  async refreshUnlock() {
    this._session = undefined
    this._items.clear()
    this._syncDone = false
    const token = await this.unlock()
    if (this.opts.cache) await this.opts.cache.set(this.cacheKey, token, this.sessionTtl)
    this._session = token
    return this._session
  }

  /**
   * `bw status.lastSync` as epoch ms, or null if never synced / unauthenticated.
   * @returns {Promise<number | null>}
   */
  async lastSyncAt() {
    const st = await this.status()
    const raw = st.lastSync
    if (!raw) return null
    const t = Date.parse(raw)
    return Number.isFinite(t) ? t : null
  }

  /**
   * Pull vault from server when `lastSync` is missing or older than `syncTtl`
   * (default 5m). Uses `bw status` for the timestamp; `syncTtl=forever` skips.
   * Single-flight per client; clears in-memory item cache after a sync.
   * @param {string} session
   * @returns {Promise<void>}
   */
  async ensureSynced(session) {
    if (this._syncDone) return
    if (this.syncTtlMs === null) {
      this._syncDone = true
      return
    }
    if (this._syncInFlight) return this._syncInFlight
    this._syncInFlight = (async () => {
      const last = await this.lastSyncAt()
      const ttl = this.syncTtlMs
      const ageOk = last != null && ttl != null && Date.now() - last < ttl
      if (!ageOk) {
        await this.run(['sync', '--nointeraction'], session)
        this._items.clear()
      }
      this._syncDone = true
    })()
    try {
      await this._syncInFlight
    } finally {
      this._syncInFlight = undefined
    }
  }

  /**
   * Whether to re-login/unlock after a CLI auth failure.
   * Manual `sessionToken` skips heal for mere locked/invalid sessions, but after
   * `bw logout` ("not logged in") we still try login when credentials exist.
   * @param {unknown} err
   * @returns {boolean}
   */
  canSelfHeal(err) {
    if (!isInvalidSessionError(err)) return false
    if (!this._manual) return true
    return isNotLoggedInError(err)
  }

  /**
   * @template T
   * @param {(session: string) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async withSession(fn) {
    /**
     * @param {string} token
     * @returns {Promise<T>}
     */
    const run = async (token) => {
      await this.ensureSynced(token)
      return await fn(token)
    }
    const token = await this.session()
    try {
      return await run(token)
    } catch (err) {
      if (!this.canSelfHeal(err)) throw err
      const fresh = await this.refreshUnlock()
      return await run(fresh)
    }
  }

  /**
   * Exact item name (or id) → JSON. Cached per client.
   * @param {string} query
   * @returns {Promise<BwItem>}
   */
  getItem(query) {
    let p = this._items.get(query)
    if (!p) {
      p = this.withSession(async (session) => {
        const res = await this.run(['get', 'item', query, '--nointeraction'], session)
        return /** @type {BwItem} */ (JSON.parse(res.stdout.toString('utf8')))
      })
      this._items.set(query, p)
    }
    return p
  }

  /**
   * @param {string} itemQuery
   * @param {string} [field]  default password
   * @returns {Promise<string>}
   */
  async getField(itemQuery, field = 'password') {
    return extractItemField(await this.getItem(itemQuery), field)
  }

  /**
   * @param {string} itemQuery
   * @param {string} fileName
   * @param {'utf8' | 'base64'} [encoding]
   * @returns {Promise<string>}
   */
  async getAttachment(itemQuery, fileName, encoding = 'utf8') {
    const item = await this.getItem(itemQuery)
    const att = pickAttachment(item, fileName)
    return this.withSession(async (session) => {
      const res = await this.run(
        ['get', 'attachment', att.fileName, '--itemid', item.id, '--raw', '--nointeraction'],
        session,
      )
      return res.stdout.toString(encoding)
    })
  }
}

module.exports = { VwClient }
