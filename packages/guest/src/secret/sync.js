/**
 * `qctl secret sync`: `@sensitive` schema items → Podman secrets.
 *
 * Convention
 *   - Schemas: unit dirs applications/<app>/<unit>/.env.schema and common/<lib>/.env.schema
 *     (the package-root applications/<app>/.env.schema is a template only, not synced).
 *   - Podman secret name = schema key as-is (CADDY_DNS → CADDY_DNS).
 *   - Store: package `app.yaml` `engine:` (`rootful` → rootful store; else rootless).
 *     `common/<lib>/` schemas are always rootless.
 *     `# @tag(cross-engine)` → both stores (shared with the other engine’s apps).
 *   - Values are the graph-resolved `@sensitive` items (lab: literals in the unit `.env.dev`;
 *     prod: `vw()` in `.env.prod`). Prod `vw()` hits are cached by `@initVw(cacheTtl=…)`
 *     in varlock's plugin cache — no sync-if-stale stamp.
 *   - Each secret is labeled `qctl.sha256=<hex>` so sync/check can skip unchanged values.
 *   - Resolution uses the varlock graph API (`@qctl/shared`), never the `varlock` CLI.
 *   - `--restart` restarts apps whose secrets changed (not for ExecStartPre — omit it there).
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { tryReadOsConfig } from '../os-config.js'
import { readEngine } from '../quadlet/apps/index.js'
import { createContext } from '../quadlet/context.js'
import { detectQctlEnvFor } from '../quadlet/env.js'
import { runRestart } from '../quadlet/lifecycle.js'
import { execSync } from '../quadlet/system.js'
import { discoverSecretConsumers } from './consumers.js'
import { SECRET_HASH_LABEL, secretContentHash } from './hash.js'
import { loadSensitiveItems } from './varlock.js'

/**
 * @typedef {'rootless' | 'rootful'} Engine
 */

/**
 * @typedef {object} PodmanRunner
 * Run `podman <args>` against one store, or `null` if that store is unavailable to this user.
 * @property {(
 *   engine: Engine,
 *   args: string[],
 *   opts?: { input?: string, capture?: boolean },
 * ) => { status: number, stdout: string } | null} run
 */

/**
 * @typedef {object} SyncOptions
 * @property {string} root
 * @property {boolean} [dryRun]
 * @property {boolean} [restart]   restart apps that consume secrets we updated
 * @property {string} [qctlEnv]
 *   sets `QCTL_ENV` for schema `@import(..., enabled=…)`
 *   (default: CLI → `/etc/qctl/config.json` → repo `.env` ENV= → `dev`)
 * @property {string} [quadletUser] apps username (default: OS config / `apps`)
 * @property {Record<string, string | undefined>} [env] ambient spawn env only
 * @property {number} [uid]
 * @property {PodmanRunner} [podman]
 * @property {(msg: string) => void} [log]
 * @property {(apps: string[]) => void | Promise<void>} [restartApps]  test seam / override
 */

/**
 * Podman secret name = schema key as-is (no case / underscore mangling).
 * @param {string} key
 * @returns {string}
 */
export function podmanSecretName(key) {
  return key
}

/**
 * Secret-sync schema dirs, sorted:
 *   - `applications/<app>/<unit>/` immediate children with a `.env.schema`
 *   - `common/<lib>/` with a `.env.schema`
 * The package-root `applications/<app>/.env.schema` is a template and is never an entry.
 * @param {string} root
 * @returns {string[]}
 */
export function discoverSchemaDirs(root) {
  /** @type {string[]} */
  const out = []
  /**
   * @param {string} base
   * @returns {string[]}
   */
  const subdirs = (base) => {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    } catch {
      return []
    }
  }
  for (const app of subdirs(join(root, 'applications'))) {
    const appDir = join(root, 'applications', app)
    for (const unit of subdirs(appDir)) {
      if (existsSync(join(appDir, unit, '.env.schema'))) out.push(join(appDir, unit))
    }
  }
  for (const lib of subdirs(join(root, 'common'))) {
    const dir = join(root, 'common', lib)
    if (existsSync(join(dir, '.env.schema'))) out.push(dir)
  }
  return out.sort()
}

/**
 * Whether secrets under `schemaDir` go to the rootful Podman store.
 * `applications/<app>/<unit>/` → `applications/<app>/app.yaml` `engine:`.
 * `common/<lib>/` → always rootless.
 *
 * @param {string} root instance root
 * @param {string} schemaDir absolute unit/common schema directory
 * @returns {boolean}
 */
export function schemaDirIsRootful(root, schemaDir) {
  const apps = join(root, 'applications')
  const rel = relative(apps, schemaDir)
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) return false
  const app = rel.split(sep)[0]
  if (!app) return false
  const appDir = join(apps, app)
  if (!existsSync(join(appDir, 'app.yaml'))) return false
  return readEngine(appDir) === 'rootful'
}

/**
 * Default podman access: root drives both stores (rootless via runuser as the apps user);
 * non-root can only drive its own rootless store.
 * @param {number} uid
 * @param {string} [quadletUser] apps username from OS config (default `apps`)
 * @returns {PodmanRunner}
 */
export function defaultPodman(uid, quadletUser = 'apps') {
  const user = quadletUser.trim() || 'apps'
  return {
    run(engine, args, opts = {}) {
      if (engine === 'rootful') {
        return uid === 0 ? execSync('podman', args, opts) : null
      }
      if (uid !== 0) return execSync('podman', args, opts)
      const home =
        execSync('getent', ['passwd', user], { capture: true }).stdout.trim().split(':')[5] || '/'
      const id = execSync('id', ['-u', user], { capture: true }).stdout.trim()
      const rt = `/run/user/${id}`
      return execSync(
        'runuser',
        [
          '-u',
          user,
          '--',
          'env',
          `XDG_RUNTIME_DIR=${rt}`,
          `DBUS_SESSION_BUS_ADDRESS=unix:path=${rt}/bus`,
          `HOME=${home}`,
          'podman',
          ...args,
        ],
        { ...opts, cwd: home },
      )
    },
  }
}

/**
 * Read `qctl.sha256` label from an existing secret, or "" if missing/unreadable.
 * @param {PodmanRunner} podman
 * @param {Engine} engine
 * @param {string} name
 * @returns {string | null} null = store unavailable; "" = no/unknown hash
 */
export function readSecretHash(podman, engine, name) {
  const fmt = `{{index .Spec.Labels "${SECRET_HASH_LABEL}"}}`
  const res = podman.run(engine, ['secret', 'inspect', name, '--format', fmt], { capture: true })
  if (res === null) return null
  if (res.status !== 0) return ''
  return (res.stdout || '').trim().replace(/^<|>$/g, '')
}

/**
 * One full pass over every schema dir.
 * @param {SyncOptions} o
 * @returns {Promise<{ synced: number, skipped: number, changed: string[] }>}
 */
export async function syncAll(o) {
  const env = o.env ?? process.env
  const uid = o.uid ?? process.getuid?.() ?? 0
  const log = o.log ?? ((m) => console.log(`secret-sync: ${m}`))
  const os = tryReadOsConfig()
  const quadletUser = o.quadletUser ?? os?.quadletUser ?? 'apps'
  const podman = o.podman ?? defaultPodman(uid, quadletUser)
  const qctlEnv = o.qctlEnv ?? detectQctlEnvFor(o.root, { osConfigEnv: os?.env })

  const dirs = discoverSchemaDirs(o.root)
  if (dirs.length === 0)
    throw new Error('no unit .env.schema under applications/<app>/<unit>/ or common/<lib>/')

  /** @type {Map<string, string>} */
  const seen = new Map()
  let synced = 0
  let skipped = 0
  /** @type {string[]} */
  const changed = []

  for (const dir of dirs) {
    const app = dir.split('/').slice(-1)[0]
    log(`schema ${app}`)
    const rootful = schemaDirIsRootful(o.root, dir)
    const items = await loadSensitiveItems(dir, { env, qctlEnv, rootful })
    for (const item of items) {
      const name = podmanSecretName(item.key)
      const owner = seen.get(name)
      if (owner) throw new Error(`secret ${name} declared twice (${owner} and ${dir})`)
      seen.set(name, dir)

      const value = item.value
      if (!value) throw new Error(`empty value for ${name} (${item.key} in ${dir})`)
      const wantHash = secretContentHash(value)
      let nameChanged = false

      for (const engine of item.engines) {
        if (engine === 'rootful' && uid !== 0) {
          log(`skip ${name} (rootful; run as root)`)
          continue
        }

        if (o.dryRun) {
          log(`dry-run: ${engine} secret create ${name} (${Buffer.byteLength(value)} bytes)`)
          synced++
          nameChanged = true
          continue
        }

        const q = { capture: true }
        const exists = podman.run(engine, ['secret', 'exists', name], q)
        if (exists === null) {
          log(`skip ${name} (${engine} store unavailable)`)
          continue
        }
        if (exists.status === 0) {
          const have = readSecretHash(podman, engine, name) ?? ''
          if (have === wantHash) {
            log(`ok ${engine} secret/${name} (unchanged)`)
            skipped++
            continue
          }
          const rm = podman.run(engine, ['secret', 'rm', name], q)
          if (rm && rm.status !== 0)
            throw new Error(`podman secret rm ${name} failed (exit ${rm.status})`)
        }
        const created = podman.run(
          engine,
          ['secret', 'create', '--label', `${SECRET_HASH_LABEL}=${wantHash}`, name, '-'],
          { input: value, capture: true },
        )
        if (created?.status !== 0) {
          throw new Error(`podman secret create ${name} failed (exit ${created?.status ?? '?'})`)
        }
        log(`ok ${engine} secret/${name}`)
        synced++
        nameChanged = true
      }
      if (nameChanged) changed.push(name)
    }
  }
  log(`done (${synced} updated, ${skipped} unchanged)`)
  return { synced, skipped, changed }
}

/**
 * Restart apps that reference any of `changed` secret names.
 * @param {SyncOptions} o
 * @param {string[]} changed
 */
export async function restartSecretConsumers(o, changed) {
  if (changed.length === 0) return
  const log = o.log ?? ((m) => console.log(`secret-sync: ${m}`))
  const consumers = discoverSecretConsumers(o.root)
  /** @type {Set<string>} */
  const apps = new Set()
  for (const name of changed) {
    const set = consumers.get(name)
    if (set) for (const a of set) apps.add(a)
  }
  const list = [...apps].sort()
  if (list.length === 0) {
    log(`restart: no Quadlet Secret= consumers for ${changed.join(', ')}`)
    return
  }
  if (o.restartApps) {
    await o.restartApps(list)
    return
  }
  const ctx = createContext({
    root: o.root,
    baseEnv: o.env ?? process.env,
    log: (m) => log(m.replace(/^quadlet:\s*/, 'restart: ')),
  })
  for (const app of list) {
    runRestart(ctx, app)
  }
}

/**
 * @param {SyncOptions} o
 * @returns {Promise<{ synced: number, skipped: number, changed: string[] }>}
 */
export async function runSecretSync(o) {
  const result = await syncAll(o)
  if (o.restart && !o.dryRun) {
    await restartSecretConsumers(o, result.changed)
  }
  return result
}
