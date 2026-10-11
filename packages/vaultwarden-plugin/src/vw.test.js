/** @import { StdioOptions } from 'node:child_process' */
/** @import { SessionCache } from './vw/client.js' */
/** @import { BwItem } from './vw/items.js' */
/** @import { InitVwArgValue, InitVwRawBag } from './vw/parse.js' */
/** @import { Runner } from './vw/runner.js' */

const { describe, expect, test } = require('bun:test')
const { homedir } = require('node:os')
const { join } = require('node:path')

const {
  DEFAULT_VW_ACCOUNT,
  VwClient,
  expandHomePath,
  extractItemField,
  parseInitVwArgKeys,
  parseInitVwArgs,
  parseVwArgs,
  pickAttachment,
  resolveVwAccountId,
  valueCacheKey,
} = require('./vw.js')

/** @type {BwItem} */
const ITEM = {
  id: 'item-1',
  name: 'rocky-caddy',
  notes: 'n',
  login: { username: 'u', password: 'p', totp: null, uris: [{ uri: 'https://x' }] },
  fields: [{ name: 'DNS_Token', value: 'tok' }],
  attachments: [{ id: 'a1', fileName: 'keys.tgz' }],
}

/**
 * @typedef {{
 *   cmd: string,
 *   args: string[],
 *   env: Record<string, string | undefined>,
 *   stdio?: StdioOptions,
 *   teeStderr?: boolean,
 * }} MockCall
 */

/**
 * @param {Record<string, string>} outputs  keyed by "arg0 arg1"
 * @param {MockCall[]} calls
 * @returns {Runner}
 */
function mockRunner(outputs, calls) {
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {{
   *   env: Record<string, string | undefined>,
   *   stdio?: StdioOptions,
   *   teeStderr?: boolean,
   * }} opts
   */
  return async (cmd, args, { env, stdio, teeStderr }) => {
    calls.push({ cmd, args, env, stdio, teeStderr })
    const key = `${args[0]} ${args[1] ?? ''}`.trim()
    if (key in outputs) return { code: 0, stdout: Buffer.from(outputs[key] ?? ''), stderr: '' }
    if (args[0] === 'status') {
      return {
        code: 0,
        stdout: Buffer.from(
          JSON.stringify({
            status: 'locked',
            serverUrl: null,
            // Fresh lastSync so default syncTtl=5m skips `bw sync` in most tests.
            lastSync: new Date().toISOString(),
          }),
        ),
        stderr: '',
      }
    }
    if (args[0] === 'sync') return { code: 0, stdout: Buffer.from(''), stderr: '' }
    if (args[0] === 'config') return { code: 0, stdout: Buffer.from(''), stderr: '' }
    if (args[0] === 'login') return { code: 0, stdout: Buffer.from('LOGINSESS\n'), stderr: '' }
    if (args[0] === 'unlock') return { code: 0, stdout: Buffer.from('SESS\n'), stderr: '' }
    return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
  }
}

describe('extractItemField', () => {
  test('standard + custom (case-insensitive)', () => {
    expect(extractItemField(ITEM, 'password')).toBe('p')
    expect(extractItemField(ITEM, 'Username')).toBe('u')
    expect(extractItemField(ITEM, 'notes')).toBe('n')
    expect(extractItemField(ITEM, 'uri')).toBe('https://x')
    expect(extractItemField(ITEM, 'dns_token')).toBe('tok')
  })

  test('missing field / null standard field throws', () => {
    expect(() => extractItemField(ITEM, 'nope')).toThrow(/not found.*DNS_Token/)
    expect(() => extractItemField(ITEM, 'totp')).toThrow(/no totp/)
  })
})

describe('pickAttachment', () => {
  test('finds by filename', () => {
    expect(pickAttachment(ITEM, 'keys.tgz').id).toBe('a1')
  })
  test('throws listing available', () => {
    expect(() => pickAttachment(ITEM, 'x')).toThrow(/keys\.tgz/)
  })
})

describe('VwClient', () => {
  test('getField: sets BITWARDENCLI_APPDATA_DIR only on child env', async () => {
    /** @type {{ cmd: string, args: string[], env: Record<string, string | undefined> }[]} */
    const calls = []
    const before = process.env.BITWARDENCLI_APPDATA_DIR
    const c = new VwClient({
      appDataDir: '/vw',
      sessionToken: 'S1',
      syncTtl: 'forever',
      env: { PATH: '/bin' },
      runner: mockRunner({ 'get item': JSON.stringify(ITEM) }, calls),
    })
    expect(await c.getField('rocky-caddy', 'DNS_TOKEN')).toBe('tok')
    const get = calls.find((x) => x.args[0] === 'get' && x.args[1] === 'item')
    expect(get?.args).toEqual(['get', 'item', 'rocky-caddy', '--nointeraction'])
    expect(get?.env.BITWARDENCLI_APPDATA_DIR).toBe('/vw')
    expect(get?.env.BW_SESSION).toBe('S1')
    expect(process.env.BITWARDENCLI_APPDATA_DIR).toBe(before)
  })

  test('item JSON is cached per client', async () => {
    /** @type {{ cmd: string, args: string[], env: Record<string, string | undefined> }[]} */
    const calls = []
    const c = new VwClient({
      sessionToken: 'S',
      syncTtl: 'forever',
      env: {},
      runner: mockRunner({ 'get item': JSON.stringify(ITEM) }, calls),
    })
    await c.getField('rocky-caddy', 'password')
    await c.getField('rocky-caddy', 'username')
    expect(calls.filter((x) => x.args[0] === 'get').length).toBe(1)
  })

  test('getAttachment calls bw get attachment with item id; base64 encoding', async () => {
    /** @type {{ cmd: string, args: string[], env: Record<string, string | undefined> }[]} */
    const calls = []
    const c = new VwClient({
      sessionToken: 'S',
      syncTtl: 'forever',
      env: {},
      runner: mockRunner({ 'get item': JSON.stringify(ITEM), 'get attachment': 'hello' }, calls),
    })
    expect(await c.getAttachment('rocky-caddy', 'keys.tgz', 'base64')).toBe(
      Buffer.from('hello').toString('base64'),
    )
    const att = calls.find((x) => x.args[0] === 'get' && x.args[1] === 'attachment')
    expect(att?.args).toEqual([
      'get',
      'attachment',
      'keys.tgz',
      '--itemid',
      'item-1',
      '--raw',
      '--nointeraction',
    ])
  })

  test('sessionToken; BW_SESSION env; master password unlock', async () => {
    /** @type {MockCall[]} */
    const calls = []
    const c1 = new VwClient({ sessionToken: 'TOK', env: {}, runner: mockRunner({}, calls) })
    expect(await c1.session()).toBe('TOK')

    const cEnv = new VwClient({ env: { BW_SESSION: 'ENVSESS' }, runner: mockRunner({}, calls) })
    expect(await cEnv.session()).toBe('ENVSESS')

    const c2 = new VwClient({
      masterPassword: 'pw',
      env: {},
      runner: mockRunner({}, calls),
    })
    expect(await c2.session()).toBe('SESS')
    expect(calls.at(-1)?.args[0]).toBe('unlock')
    expect(calls.at(-1)?.args.join(' ')).not.toContain('pw')
  })

  test('interactive unlock on TTY; errors without TTY', async () => {
    /** @type {MockCall[]} */
    const calls = []
    const c = new VwClient({
      env: {},
      isTTY: () => true,
      promptPassword: async () => 'secret',
      runner: mockRunner({}, calls),
    })
    expect(await c.session()).toBe('SESS')
    expect(calls.at(-1)?.args).toEqual(['unlock', '--passwordenv', 'QCTL_VW_MASTER', '--raw'])
    expect(calls.at(-1)?.env.QCTL_VW_MASTER).toBe('secret')
    expect(calls.at(-1)?.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(calls.some((x) => x.args[0] === 'status')).toBe(true)

    const headless = new VwClient({
      env: {},
      isTTY: () => false,
      runner: mockRunner({}, calls),
    })
    await expect(headless.session()).rejects.toThrow(/TTY/)
  })

  test('invalid master password is a clear error (no crypto dump)', async () => {
    const c = new VwClient({
      env: {},
      masterPassword: 'wrong',
      runner: async (_cmd, args) => {
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout: Buffer.from(JSON.stringify({ status: 'locked' })),
            stderr: '',
          }
        }
        if (args[0] === 'unlock') {
          return {
            code: 1,
            stdout: Buffer.alloc(0),
            stderr: `${'Cryptography error: Decryption operation failed.\n'.repeat(3)}Mac failed.\n`,
          }
        }
        return { code: 1, stdout: Buffer.alloc(0), stderr: 'unexpected' }
      },
    })
    await expect(c.session()).rejects.toThrow('invalid master password')
    await expect(c.session()).rejects.not.toThrow(/Cryptography|Decryption/)
  })

  test('unauthenticated: interactive login --raw skips unlock; apikey + serverUrl', async () => {
    /** @type {MockCall[]} */
    const calls = []
    let loggedIn = false
    const interactive = new VwClient({
      env: {},
      isTTY: () => true,
      runner: async (_cmd, args, opts) => {
        calls.push({
          cmd: _cmd,
          args,
          env: opts.env,
          stdio: opts.stdio,
          teeStderr: opts.teeStderr,
        })
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout: Buffer.from(
              JSON.stringify({ status: loggedIn ? 'locked' : 'unauthenticated' }),
            ),
            stderr: '',
          }
        }
        if (args[0] === 'login') {
          loggedIn = true
          expect(args).toEqual(['login', '--raw'])
          return { code: 0, stdout: Buffer.from('LOGINSESS\n'), stderr: '' }
        }
        if (args[0] === 'unlock') return { code: 0, stdout: Buffer.from('SESS\n'), stderr: '' }
        return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
      },
    })
    expect(await interactive.session()).toBe('LOGINSESS')
    expect(calls.find((x) => x.args[0] === 'login')?.teeStderr).toBe(true)
    expect(calls.filter((x) => x.args[0] === 'unlock').length).toBe(0)

    /** @type {MockCall[]} */
    const apiCalls = []
    let apiLogged = false
    const api = new VwClient({
      serverUrl: 'https://vw.example/',
      clientId: 'cid',
      clientSecret: 'csec',
      masterPassword: 'pw',
      env: {},
      isTTY: () => false,
      runner: async (_cmd, args, opts) => {
        apiCalls.push({ cmd: _cmd, args, env: opts.env, stdio: opts.stdio })
        if (args[0] === 'config') return { code: 0, stdout: Buffer.alloc(0), stderr: '' }
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout: Buffer.from(
              JSON.stringify({ status: apiLogged ? 'locked' : 'unauthenticated' }),
            ),
            stderr: '',
          }
        }
        if (args[0] === 'login') {
          apiLogged = true
          expect(opts.env.BW_CLIENTID).toBe('cid')
          expect(opts.env.BW_CLIENTSECRET).toBe('csec')
          return { code: 0, stdout: Buffer.alloc(0), stderr: '' }
        }
        if (args[0] === 'unlock') return { code: 0, stdout: Buffer.from('APISESS\n'), stderr: '' }
        return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
      },
    })
    expect(await api.session()).toBe('APISESS')
    expect(apiCalls.find((x) => x.args[0] === 'config')?.args).toEqual([
      'config',
      'server',
      'https://vw.example/',
    ])
    expect(apiCalls.find((x) => x.args[0] === 'login')?.args).toEqual(['login', '--apikey'])

    /** Already logged in: serverUrl must not call `bw config server`. */
    /** @type {{ cmd: string, args: string[] }[]} */
    const loggedCalls = []
    const alreadyIn = new VwClient({
      serverUrl: 'https://vw.example/',
      env: {},
      isTTY: () => true,
      promptPassword: async () => 'pw',
      runner: async (_cmd, args) => {
        loggedCalls.push({ cmd: _cmd, args })
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout: Buffer.from(
              JSON.stringify({ status: 'locked', serverUrl: 'https://vw.example' }),
            ),
            stderr: '',
          }
        }
        if (args[0] === 'config') {
          return {
            code: 1,
            stdout: Buffer.alloc(0),
            stderr: 'Logout required before server config update.',
          }
        }
        if (args[0] === 'unlock') return { code: 0, stdout: Buffer.from('OK\n'), stderr: '' }
        return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
      },
    })
    expect(await alreadyIn.session()).toBe('OK')
    expect(loggedCalls.some((x) => x.args[0] === 'config')).toBe(false)

    const headlessNoCreds = new VwClient({
      env: {},
      isTTY: () => false,
      runner: async (_cmd, args) => {
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout: Buffer.from(JSON.stringify({ status: 'unauthenticated' })),
            stderr: '',
          }
        }
        return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
      },
    })
    await expect(headlessNoCreds.session()).rejects.toThrow(/clientId/)
  })

  test('auto-unlock uses plugin cache getOrSet', async () => {
    /** @type {Map<string, string>} */
    const store = new Map()
    /** @type {MockCall[]} */
    const calls = []
    /** @type {SessionCache} */
    const cache = {
      /**
       * @param {string} key
       * @param {string | number} _ttl
       * @param {() => Promise<string>} producer
       */
      async getOrSet(key, _ttl, producer) {
        if (store.has(key)) return /** @type {string} */ (store.get(key))
        const v = await producer()
        store.set(key, v)
        return v
      },
      /**
       * @param {string} key
       * @param {string} value
       */
      async set(key, value) {
        store.set(key, value)
      },
    }
    const c = new VwClient({
      appDataDir: '/vw',
      env: {},
      isTTY: () => true,
      promptPassword: async () => 'pw',
      cache,
      runner: mockRunner({}, calls),
    })
    expect(await c.session()).toBe('SESS')
    expect(await c.session()).toBe('SESS')
    expect(calls.filter((x) => x.args[0] === 'unlock').length).toBe(1)
    expect([...store.keys()][0]).toMatch(/^vw-session:/)
  })

  test('self-heals stale cached session once', async () => {
    let gets = 0
    /** @type {SessionCache} */
    const cache = {
      /**
       * @param {string} _k
       * @param {string | number} _t
       * @param {() => Promise<string>} producer
       */
      async getOrSet(_k, _t, producer) {
        return producer()
      },
      async set() {},
    }
    /**
     * @type {Runner}
     * @param {string} _cmd
     * @param {string[]} args
     */
    const runner = async (_cmd, args) => {
      if (args[0] === 'status') {
        return {
          code: 0,
          stdout: Buffer.from(
            JSON.stringify({ status: 'locked', lastSync: new Date().toISOString() }),
          ),
          stderr: '',
        }
      }
      if (args[0] === 'sync') return { code: 0, stdout: Buffer.from(''), stderr: '' }
      if (args[0] === 'unlock') return { code: 0, stdout: Buffer.from('FRESH\n'), stderr: '' }
      gets += 1
      if (gets === 1) {
        return { code: 1, stdout: Buffer.alloc(0), stderr: 'Vault is locked.' }
      }
      return { code: 0, stdout: Buffer.from(JSON.stringify(ITEM)), stderr: '' }
    }
    const c = new VwClient({
      env: {},
      isTTY: () => true,
      promptPassword: async () => 'pw',
      cache,
      runner,
    })
    expect(await c.getField('rocky-caddy', 'password')).toBe('p')
    expect(gets).toBe(2)
  })

  test('self-heals after bw logout (sync "not logged in") via apikey login', async () => {
    let loggedIn = false
    /** @type {string[]} */
    const ops = []
    /** @type {SessionCache} */
    const cache = {
      async getOrSet(_k, _t, producer) {
        return producer()
      },
      async set() {},
    }
    /** @type {Runner} */
    const runner = async (_cmd, args) => {
      ops.push(args[0] ?? '')
      if (args[0] === 'status') {
        return {
          code: 0,
          stdout: Buffer.from(
            JSON.stringify({
              status: loggedIn ? 'locked' : 'unauthenticated',
              lastSync: loggedIn ? new Date().toISOString() : null,
            }),
          ),
          stderr: '',
        }
      }
      if (args[0] === 'sync') {
        if (!loggedIn) {
          return { code: 1, stdout: Buffer.alloc(0), stderr: 'You are not logged in.' }
        }
        return { code: 0, stdout: Buffer.from(''), stderr: '' }
      }
      if (args[0] === 'login' && args.includes('--apikey')) {
        loggedIn = true
        return { code: 0, stdout: Buffer.from(''), stderr: '' }
      }
      if (args[0] === 'unlock') return { code: 0, stdout: Buffer.from('NEWSESS\n'), stderr: '' }
      if (args[0] === 'get') {
        return { code: 0, stdout: Buffer.from(JSON.stringify(ITEM)), stderr: '' }
      }
      return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
    }
    // sessionToken marks _manual — logout must still re-login when API key is set.
    const c = new VwClient({
      sessionToken: 'STALE',
      clientId: 'cid',
      clientSecret: 'csec',
      masterPassword: 'mp',
      syncTtl: '5m',
      env: {},
      cache,
      runner,
    })
    expect(await c.getField('rocky-caddy', 'password')).toBe('p')
    expect(ops).toContain('login')
    expect(ops).toContain('unlock')
    expect(loggedIn).toBe(true)
  })

  test('bw failure surfaces stderr', async () => {
    const c = new VwClient({ sessionToken: 'S', env: {}, runner: mockRunner({}, []) })
    await expect(c.getField('x')).rejects.toThrow(/nope/)
  })

  test('ensureSynced skips bw sync when lastSync within syncTtl', async () => {
    /** @type {MockCall[]} */
    const calls = []
    const c = new VwClient({
      sessionToken: 'S',
      syncTtl: '5m',
      env: {},
      runner: mockRunner({ 'get item': JSON.stringify(ITEM) }, calls),
    })
    await c.getField('rocky-caddy', 'password')
    expect(calls.some((x) => x.args[0] === 'status')).toBe(true)
    expect(calls.some((x) => x.args[0] === 'sync')).toBe(false)
  })

  test('ensureSynced runs bw sync when lastSync is stale or missing', async () => {
    /** @type {MockCall[]} */
    const calls = []
    /** @type {Runner} */
    const runner = async (_cmd, args) => {
      calls.push({ cmd: 'bw', args, env: {}, stdio: undefined, teeStderr: undefined })
      if (args[0] === 'status') {
        return {
          code: 0,
          stdout: Buffer.from(
            JSON.stringify({
              status: 'unlocked',
              lastSync: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            }),
          ),
          stderr: '',
        }
      }
      if (args[0] === 'sync') return { code: 0, stdout: Buffer.from(''), stderr: '' }
      if (args[0] === 'get')
        return { code: 0, stdout: Buffer.from(JSON.stringify(ITEM)), stderr: '' }
      return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
    }
    const c = new VwClient({
      sessionToken: 'S',
      syncTtl: 60_000,
      env: {},
      runner,
    })
    await c.getField('rocky-caddy', 'password')
    expect(calls.filter((x) => x.args[0] === 'sync').length).toBe(1)
    expect(calls.find((x) => x.args[0] === 'sync')?.args).toEqual(['sync', '--nointeraction'])
  })

  test('syncTtl=forever never syncs', async () => {
    /** @type {MockCall[]} */
    const calls = []
    /** @type {Runner} */
    const runner = async (_cmd, args) => {
      calls.push({ cmd: 'bw', args, env: {}, stdio: undefined, teeStderr: undefined })
      if (args[0] === 'status') {
        return {
          code: 0,
          stdout: Buffer.from(JSON.stringify({ status: 'unlocked', lastSync: null })),
          stderr: '',
        }
      }
      if (args[0] === 'get')
        return { code: 0, stdout: Buffer.from(JSON.stringify(ITEM)), stderr: '' }
      return { code: 1, stdout: Buffer.alloc(0), stderr: 'nope' }
    }
    const c = new VwClient({
      sessionToken: 'S',
      syncTtl: 'forever',
      env: {},
      runner,
    })
    await c.getField('rocky-caddy', 'password')
    expect(calls.some((x) => x.args[0] === 'sync')).toBe(false)
    expect(calls.some((x) => x.args[0] === 'status')).toBe(false)
  })
})

describe('valueCacheKey', () => {
  test('field and attachment keys include account + call shape', () => {
    expect(
      valueCacheKey('/vw', {
        kind: 'field',
        item: 'rocky-caddy',
        field: 'password',
        accountId: DEFAULT_VW_ACCOUNT,
      }),
    ).toBe('vw:default:626cdfc5f4f1:rocky-caddy:field:password')
    expect(
      valueCacheKey('/vw', {
        kind: 'field',
        item: 'rocky-caddy',
        field: 'password',
        accountId: 'work',
      }),
    ).toBe('vw:work:626cdfc5f4f1:rocky-caddy:field:password')
    expect(
      valueCacheKey(undefined, {
        kind: 'attachment',
        item: 'rocky',
        file: 'key.pem',
        encoding: 'utf8',
        accountId: DEFAULT_VW_ACCOUNT,
      }),
    ).toBe('vw:default:rocky:att:key.pem:utf8')
  })
})

describe('resolveVwAccountId', () => {
  test('omitted / blank → default Symbol; otherwise trimmed string', () => {
    expect(resolveVwAccountId(undefined)).toBe(DEFAULT_VW_ACCOUNT)
    expect(resolveVwAccountId(null)).toBe(DEFAULT_VW_ACCOUNT)
    expect(resolveVwAccountId('')).toBe(DEFAULT_VW_ACCOUNT)
    expect(resolveVwAccountId('  ')).toBe(DEFAULT_VW_ACCOUNT)
    expect(resolveVwAccountId('work')).toBe('work')
    expect(resolveVwAccountId(' work ')).toBe('work')
  })
})

describe('parseVwArgs', () => {
  test('defaults field to password and account to DEFAULT_VW_ACCOUNT', () => {
    expect(parseVwArgs({ item: 'rocky' })).toEqual({
      kind: 'field',
      item: 'rocky',
      field: 'password',
      accountId: DEFAULT_VW_ACCOUNT,
    })
  })

  test('named field= + accountId', () => {
    expect(
      parseVwArgs({ accountId: 'work', item: 'rocky-caddy', field: 'dns_digitalocean_token' }),
    ).toEqual({
      kind: 'field',
      item: 'rocky-caddy',
      field: 'dns_digitalocean_token',
      accountId: 'work',
    })
  })

  test('attachment defaults encoding utf8', () => {
    expect(parseVwArgs({ item: 'rocky', attachment: 'key.pem' })).toEqual({
      kind: 'attachment',
      item: 'rocky',
      file: 'key.pem',
      encoding: 'utf8',
      accountId: DEFAULT_VW_ACCOUNT,
    })
  })

  test('attachment with encoding=base64', () => {
    expect(parseVwArgs({ item: 'rocky', attachment: 'keys.tgz', encoding: 'base64' })).toEqual({
      kind: 'attachment',
      item: 'rocky',
      file: 'keys.tgz',
      encoding: 'base64',
      accountId: DEFAULT_VW_ACCOUNT,
    })
  })

  test('rejects field= with attachment=', () => {
    expect(() => parseVwArgs({ item: 'x', field: 'password', attachment: 'a' })).toThrow(/not both/)
  })

  test('rejects encoding without attachment', () => {
    expect(() => parseVwArgs({ item: 'x', encoding: 'base64' })).toThrow(/requires attachment/)
  })

  test('rejects bad encoding', () => {
    expect(() => parseVwArgs({ item: 'x', attachment: 'a', encoding: 'hex' })).toThrow(
      /utf8 or base64/,
    )
  })

  test('rejects empty item', () => {
    expect(() => parseVwArgs({ item: '' })).toThrow(/item name/)
  })
})

describe('parseInitVwArgs', () => {
  test('allows empty / partial options; coerces empty sessionToken', () => {
    expect(parseInitVwArgs({})).toEqual({})
    expect(parseInitVwArgs({ appDataDir: '/vw', sessionToken: 'TOK' })).toEqual({
      appDataDir: '/vw',
      sessionToken: 'TOK',
    })
    expect(parseInitVwArgs({ sessionToken: '' })).toEqual({})
    expect(parseInitVwArgs({ id: 'work', appDataDir: '/vw' })).toEqual({
      id: 'work',
      appDataDir: '/vw',
    })
  })

  test('expands leading ~ on appDataDir', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/vw-work')).toBe(join(homedir(), 'vw-work'))
    expect(expandHomePath('/abs')).toBe('/abs')
    expect(expandHomePath('~other')).toBe('~other')
    expect(parseInitVwArgs({ appDataDir: '~/vw' })).toEqual({
      appDataDir: join(homedir(), 'vw'),
    })
  })

  test('id= must be a string literal at process time (no resolvers)', () => {
    expect(parseInitVwArgKeys({ id: 'work', appDataDir: '/vw-work' })).toEqual({
      id: 'work',
      appDataDir: '/vw-work',
    })
    // Varlock wraps bare literals as StaticValueResolver
    expect(
      parseInitVwArgKeys({
        id: { isStatic: true, staticValue: 'perso', resolve: async () => 'perso' },
        appDataDir: '/home/u/.config/Bitwarden CLI',
      }),
    ).toMatchObject({ id: 'perso' })
    expect(parseInitVwArgKeys({ id: '' })).toEqual({}) // empty → omit → default account
    expect(() => parseInitVwArgKeys({ id: { resolve: async () => 'work' } })).toThrow(/id=/)
  })

  test('id= requires appDataDir=', () => {
    expect(() => parseInitVwArgKeys({ id: 'work' })).toThrow(/id= requires appDataDir/)
    expect(() => parseInitVwArgs({ id: 'work' })).toThrow(/id= requires appDataDir/)
    expect(
      parseInitVwArgKeys({ id: 'work', appDataDir: { resolve: async () => '/vw' } }),
    ).toMatchObject({
      id: 'work',
    })
  })

  test('rejects blank-only after coerce for other fields stays optional', () => {
    expect(parseInitVwArgs({ bin: '' })).toEqual({})
    expect(parseInitVwArgs({ masterPassword: 'x' })).toEqual({ masterPassword: 'x' })
  })

  test('clientId and clientSecret must both be set', () => {
    expect(parseInitVwArgs({ clientId: 'a', clientSecret: 'b' })).toEqual({
      clientId: 'a',
      clientSecret: 'b',
    })
    expect(() => parseInitVwArgs({ clientId: 'a' })).toThrow(/clientId and clientSecret/)
    expect(() => parseInitVwArgs({ clientSecret: 'b' })).toThrow(/clientId and clientSecret/)
  })

  test('rejects unknown keys (including removed sessionFile)', () => {
    expect(() =>
      parseInitVwArgs(/** @type {InitVwRawBag} */ ({ appDataDir: '/vw', fake: 'x' })),
    ).toThrow(/unknown argument/)
    expect(() =>
      parseInitVwArgs(/** @type {InitVwRawBag} */ ({ sessionFile: '/run/vw.session' })),
    ).toThrow(/unknown argument/)
    expect(() => parseInitVwArgKeys(/** @type {InitVwRawBag} */ ({ typo: 1 }))).toThrow(
      /unknown argument/,
    )
  })

  test('parseInitVwArgKeys allows resolvers and rejects junk types', () => {
    expect(parseInitVwArgKeys({ appDataDir: { resolve: async () => '/vw' } })).toHaveProperty(
      'appDataDir',
    )
    expect(parseInitVwArgKeys({ cacheTtl: '5m', sessionTtl: 60_000 })).toMatchObject({
      cacheTtl: '5m',
      sessionTtl: 60_000,
    })
    expect(() =>
      parseInitVwArgKeys({ appDataDir: /** @type {InitVwArgValue} */ ({ nope: true }) }),
    ).toThrow(/string or varlock resolver/)
    expect(() => parseInitVwArgKeys({ appDataDir: 1 })).toThrow(/string or varlock resolver/)
    expect(() => parseInitVwArgKeys({ cacheTtl: true })).toThrow(
      /TTL string\/number or varlock resolver/,
    )
  })

  test('rejects invalid resolved TTL shapes', () => {
    expect(() => parseInitVwArgs({ cacheTtl: 'nope' })).toThrow(/duration/)
    expect(() => parseInitVwArgs({ sessionTtl: 0 })).toThrow(/positive|TTL/)
    expect(parseInitVwArgs({ cacheTtl: '5m', sessionTtl: 'forever' })).toMatchObject({
      cacheTtl: '5m',
      sessionTtl: 'forever',
    })
  })
})
