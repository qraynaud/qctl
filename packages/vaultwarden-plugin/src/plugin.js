/** @import { Resolver } from 'varlock/plugin-lib' */
/** @import { SessionCache } from './vw/client.js' */
/** @import { InitVwArgs, InitVwRawBag, VwAccountId, VwCall } from './vw/parse.js' */

/**
 * `@initVw` process → execute payload (resolvers still unresolved until execute).
 * @typedef {object} InitVwProcessed
 * @property {string} [id]
 * @property {VwAccountId} accountId
 * @property {Resolver} [appDataDir]
 * @property {Resolver} [sessionToken]
 * @property {Resolver} [masterPassword]
 * @property {Resolver} [serverUrl]
 * @property {Resolver} [clientId]
 * @property {Resolver} [clientSecret]
 * @property {Resolver} [sessionTtl]
 * @property {Resolver} [cacheTtl]
 * @property {Resolver} [syncTtl]
 * @property {Resolver} [bin]
 */

/**
 * `vw()` process → resolve payload (child resolvers before string await).
 * @typedef {object} VwResolveRaw
 * @property {Resolver} [accountId]
 * @property {Resolver} [item]
 * @property {Resolver} [field]
 * @property {Resolver} [attachment]
 * @property {Resolver} [encoding]
 */

/*
 * Varlock plugin entry (loaded by varlock via @plugin(<path>)).
 *
 * Schema usage (aligned with official @initBwp / BWP_SESSION):
 *
 *   # @plugin(@qctl/vaultwarden-plugin)
 *   # @initVw(appDataDir=/vw, sessionToken=$BW_SESSION, cacheTtl=5m, syncTtl=5m)
 *   # @initVw(id=work, appDataDir=/vw-work, sessionToken=$BW_SESSION_WORK)
 *   # ---
 *   # @type=vwSession
 *   BW_SESSION=
 *
 * cacheTtl caches every resolved vw() value in varlock's encrypted plugin cache
 * (cross-process locked), like official @initBwp(cacheTtl=…).
 * syncTtl skips `bw sync` when status.lastSync is newer (default 5m; forever = off).
 *
 * Multi-account: omit `id=` for the default account (Symbol key); pass `id=name`
 * for additional vaults. `vw("item")` uses default; `vw("name", "item")` selects
 * that account (field=/attachment= stay named).
 */
const { plugin, resolveCacheTtl } = require('varlock/plugin-lib')
const {
  DEFAULT_VW_ACCOUNT,
  VwClient,
  formatVwAccountId,
  parseInitVwArgKeys,
  parseInitVwArgs,
  parseVwArgs,
  resolveVwAccountId,
  valueCacheKey,
} = require('./vw/index.js')

const { SchemaError, ResolutionError } = plugin.ERRORS

plugin.name = 'qctl-vaultwarden'
plugin.icon = 'mdi:shield-key'

/**
 * Capture during module load while the plugin context is active.
 * The accessor reads `plugin._cacheStore` dynamically (wired later in finishLoad).
 * Do NOT call `plugin.cache` at resolve time — the active context is gone by then
 * and unlock would skip the disk cache (prompt every `qctl vm seed`).
 * @type {SessionCache | undefined}
 */
let pluginCache
try {
  pluginCache = plugin.cache
} catch {
  // loaded outside an active plugin context
}

/** @type {Map<VwAccountId, InstanceType<typeof VwClient>>} */
const clients = new Map()

/**
 * Resolve a varlock arg to a string, preserving empty strings for Zod preprocess.
 * @param {Resolver | null | undefined} resolver
 * @returns {Promise<string | undefined>}
 */
async function resolveOptionalString(resolver) {
  if (resolver == null) return undefined
  const v = await resolver.resolve()
  if (v == null) return undefined
  if (typeof v !== 'string') {
    throw new Error(`expected string, got ${typeof v}`)
  }
  return v
}

/**
 * @param {Resolver | null | undefined} resolver
 * @returns {Promise<string | undefined>}
 */
async function resolveString(resolver) {
  const v = await resolveOptionalString(resolver)
  return v || undefined
}

/**
 * @param {VwAccountId} accountId
 * @returns {InstanceType<typeof VwClient>}
 */
function requireClient(accountId) {
  const client = clients.get(accountId)
  if (!client) {
    const tip =
      accountId === DEFAULT_VW_ACCOUNT
        ? 'Add `# @initVw(appDataDir=/vw)` or `# @initVw(sessionToken=$BW_SESSION)` to the schema'
        : `Add \`# @initVw(id=${formatVwAccountId(accountId)}, …)\` to the schema`
    throw new SchemaError(
      `Vaultwarden plugin not initialized for account ${formatVwAccountId(accountId)}`,
      { tip },
    )
  }
  return client
}

plugin.registerRootDecorator({
  name: 'initVw',
  description:
    'Initialize Vaultwarden (bw CLI): id, appDataDir, sessionToken, masterPassword, serverUrl, '
    + 'clientId, clientSecret, sessionTtl, cacheTtl, syncTtl (repeatable with distinct id=)',
  isFunction: true,
  /**
   * @param {Resolver} argsVal
   * @returns {Promise<InitVwProcessed>}
   */
  async process(argsVal) {
    const arr = argsVal.arrArgs ?? []
    if (arr.length > 0) {
      throw new SchemaError(
        '@initVw: use named arguments only (id=, appDataDir=, sessionToken=, masterPassword=, '
          + 'serverUrl=, clientId=, clientSecret=, sessionTtl=, cacheTtl=, syncTtl=, bin=)',
      )
    }
    const o = argsVal.objArgs ?? {}
    /** @type {{ id?: string }} */
    let keys
    try {
      keys = parseInitVwArgKeys(/** @type {InitVwRawBag} */ (o))
    } catch (e) {
      throw new SchemaError(e instanceof Error ? e.message : String(e))
    }
    const accountId = resolveVwAccountId(keys.id)
    if (clients.has(accountId)) {
      throw new SchemaError(
        accountId === DEFAULT_VW_ACCOUNT
          ? '@initVw: default account already initialized (omit id= only once; use id=… for more)'
          : `@initVw: duplicate id=${formatVwAccountId(accountId)}`,
      )
    }
    // Placeholder so vw() process() can verify init; options resolved in execute().
    clients.set(accountId, new VwClient({ accountId }))
    return {
      id: keys.id,
      accountId,
      appDataDir: o.appDataDir,
      sessionToken: o.sessionToken,
      masterPassword: o.masterPassword,
      serverUrl: o.serverUrl,
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      sessionTtl: o.sessionTtl,
      cacheTtl: o.cacheTtl,
      syncTtl: o.syncTtl,
      bin: o.bin,
    }
  },
  /**
   * @param {InitVwProcessed} r
   * @returns {Promise<void>}
   */
  async execute(r) {
    /** @type {VwAccountId} */
    const accountId = r.accountId ?? DEFAULT_VW_ACCOUNT
    /** @type {string | number} */
    let sessionTtl = 'forever'
    /** @type {string | number | undefined} */
    let cacheTtl
    /** @type {string | number | undefined} */
    let syncTtl = '5m'
    try {
      const st = await resolveCacheTtl(r.sessionTtl)
      if (st !== undefined) sessionTtl = st
      cacheTtl = await resolveCacheTtl(r.cacheTtl)
      const syn = await resolveCacheTtl(r.syncTtl)
      if (syn !== undefined) syncTtl = syn
    } catch (e) {
      throw new SchemaError(e instanceof Error ? e.message : String(e))
    }
    /** @type {InitVwArgs} */
    let opts
    try {
      opts = parseInitVwArgs({
        id: typeof r.id === 'string' ? r.id : undefined,
        appDataDir: await resolveOptionalString(r.appDataDir),
        sessionToken: await resolveOptionalString(r.sessionToken),
        masterPassword: await resolveOptionalString(r.masterPassword),
        serverUrl: await resolveOptionalString(r.serverUrl),
        clientId: await resolveOptionalString(r.clientId),
        clientSecret: await resolveOptionalString(r.clientSecret),
        bin: await resolveOptionalString(r.bin),
        sessionTtl,
        cacheTtl,
        syncTtl,
      })
    } catch (e) {
      throw new SchemaError(e instanceof Error ? e.message : String(e))
    }
    clients.set(
      accountId,
      new VwClient({
        ...opts,
        accountId,
        cache: pluginCache,
      }),
    )
  },
})

plugin.registerDataType({
  name: 'vwSession',
  sensitive: true,
  internal: true,
  typeDescription: 'Bitwarden/Vaultwarden CLI session token (output of `bw unlock --raw`)',
  /**
   * @param {string | null | undefined} val
   * @returns {Promise<void>}
   */
  async validate(val) {
    if (val == null || val === '') return
    if (typeof val !== 'string') {
      throw new plugin.ERRORS.ValidationError('session token must be a string')
    }
  },
})

/**
 * @param {VwCall} call
 * @returns {Promise<string>}
 */
async function fetchVw(call) {
  const client = requireClient(call.accountId)
  if (call.kind === 'attachment') {
    return await client.getAttachment(call.item, call.file, call.encoding)
  }
  return await client.getField(call.item, call.field)
}

plugin.registerResolverFunction({
  name: 'vw',
  label:
    'Vaultwarden item: vw("item") | vw("accountId", "item"); field=/attachment=/encoding= named',
  argsSchema: { type: 'mixed', arrayMinLength: 1, arrayMaxLength: 2 },
  /**
   * @returns {VwResolveRaw}
   */
  process() {
    if (clients.size === 0) {
      throw new SchemaError('Vaultwarden plugin not initialized', {
        tip: 'Add `# @initVw(appDataDir=/vw)` or `# @initVw(sessionToken=$BW_SESSION)` to the schema',
      })
    }
    const arr = this.arrArgs ?? []
    const obj = this.objArgs ?? {}
    if (arr.length === 0 || arr.length > 2) {
      throw new SchemaError(
        'vw(): expected vw("item") or vw("accountId", "item") with optional field=/attachment=/encoding=',
      )
    }
    // Two positionals → (accountId, item). One → default account + item.
    // Field is named-only (positional field was removed for multi-account).
    if (arr.length === 2) {
      return {
        accountId: arr[0],
        item: arr[1],
        field: obj.field,
        attachment: obj.attachment,
        encoding: obj.encoding,
      }
    }
    return {
      accountId: undefined,
      item: arr[0],
      field: obj.field,
      attachment: obj.attachment,
      encoding: obj.encoding,
    }
  },
  /**
   * @param {VwResolveRaw} raw
   * @returns {Promise<string>}
   */
  async resolve(raw) {
    /**
     * @type {{
     *   accountId?: string,
     *   item?: string,
     *   field?: string,
     *   attachment?: string,
     *   encoding?: string,
     * }}
     */
    const resolved = {
      accountId: raw.accountId !== undefined ? await resolveString(raw.accountId) : undefined,
      item: await resolveString(raw.item),
      field: raw.field !== undefined ? await resolveString(raw.field) : undefined,
      attachment: raw.attachment !== undefined ? await resolveString(raw.attachment) : undefined,
      encoding: raw.encoding !== undefined ? await resolveString(raw.encoding) : undefined,
    }
    /** @type {VwCall} */
    let call
    try {
      call = parseVwArgs(resolved)
    } catch (e) {
      throw new SchemaError(e instanceof Error ? e.message : String(e))
    }
    try {
      const client = requireClient(call.accountId)
      if (client.cacheTtl !== undefined && pluginCache) {
        const key = valueCacheKey(client.opts.appDataDir, call)
        return await pluginCache.getOrSet(key, client.cacheTtl, () => fetchVw(call))
      }
      return await fetchVw(call)
    } catch (e) {
      if (e instanceof SchemaError) throw e
      throw new ResolutionError(e instanceof Error ? e.message : String(e))
    }
  },
})
