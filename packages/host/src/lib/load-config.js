/**
 * VM config: `provision/<env>.yaml` (+ `<env>.<target>.yaml`) via
 * `@qctl/shared` `loadProvision` (`!env` from process.env /
 * `provision/.env.<env>` via loadHostEnv), then zod-validated by the provision
 * schema. Tier-0 credentials come from provision YAML
 * (`tank` / `admin` / `repo.deploy_key` / …) via `!env`. Optional extra
 * `@tag(guest)` keys are still sealed. Admin SSH pubkeys: `ssh.authorized_keys`.
 *
 * Prefer {@link loadEnvProvisionSafe} for soft paths; {@link loadEnvProvision}
 * dies on failure. One env+target per process lifetime (cached); call
 * {@link clearEnvProvisionCache} in tests.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { chalk, path } from 'zx'

import { loadHostGuestCredentials, loadProvision } from '@qctl/shared'

import {
  alignProxmoxNets,
  collectDisksWarnings,
  firstBootCredentialsFromProvision,
  parseProvisionOrThrow,
} from '../provision/schema/index.js'
import { getProvision, tryGetRepoRoot } from './paths.js'
import { TARGETS } from './target.js'
import { die } from './util.js'

/** @import { YamlMapping } from '@qctl/shared' */
/** @import { FirstBootCredentials } from '../provision/schema/first-boot.js' */
/** @import { LoadedProvision, LoadEnvProvisionResult } from './load-config-types.js' */

/** Preferred pubkey filenames (ed25519 first). */
const SSH_PUB_CANDIDATES = ['id_ed25519.pub', 'id_rsa.pub']

/**
 * Single-flight cache: one env+target per process (commands never mix).
 * @type {{ key: string, result: LoadEnvProvisionResult } | null}
 */
let provisionCache = null

/**
 * Drop the provision load cache (tests / rare re-load after mutating YAML).
 */
export function clearEnvProvisionCache() {
  provisionCache = null
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function readSshPubFile(filePath) {
  if (!existsSync(filePath)) return []
  /** @type {string[]} */
  const out = []
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#')) out.push(t)
  }
  return out
}

/**
 * Normalize `ssh.authorized_keys` (string or string[]) into pubkey lines.
 * @param {string | string[] | undefined} ak
 * @returns {string[]}
 */
function collectSshAuthorizedKeys(ak) {
  /** @type {string[]} */
  const out = []
  if (Array.isArray(ak)) {
    for (const k of ak) {
      const t = String(k || '').trim()
      if (t && !t.startsWith('#')) out.push(t)
    }
  } else if (typeof ak === 'string' && ak.trim()) {
    for (const line of ak.split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('#')) out.push(t)
    }
  }
  return out
}

/**
 * Fallback: `id_ed25519.pub` / `id_rsa.pub` beside provision YAML, then `~/.ssh/`.
 * @param {string[]} provisionPaths
 * @returns {{ keys: string[], source: string } | null}
 */
function fallbackSshAuthorizedKeys(provisionPaths) {
  const dirs = [...new Set(provisionPaths.map((p) => path.dirname(p)))]
  for (const dir of dirs) {
    for (const name of SSH_PUB_CANDIDATES) {
      const fp = path.join(dir, name)
      const keys = readSshPubFile(fp)
      if (keys.length) return { keys, source: fp }
    }
  }
  const home = process.env.HOME?.trim() || homedir()
  const homeSsh = path.join(home, '.ssh')
  for (const name of SSH_PUB_CANDIDATES) {
    const fp = path.join(homeSsh, name)
    const keys = readSshPubFile(fp)
    if (keys.length) return { keys, source: fp }
  }
  return null
}

/**
 * @param {string} target
 * @returns {"local" | "proxmox"}
 */
function normalizeTarget(target) {
  return /** @type {"local" | "proxmox"} */ (
    /** @type {readonly string[]} */ (TARGETS).includes(target) ? target : 'local'
  )
}

/**
 * @param {string} e
 * @param {"local" | "proxmox"} t
 * @returns {string}
 */
function cacheKey(e, t) {
  return `${e}\0${t}`
}

/**
 * Uncached load (throws). Used only by {@link loadEnvProvisionSafe}.
 * @param {{ env: string, target: "local" | "proxmox" }} opts
 * @returns {Promise<LoadedProvision>}
 */
async function loadEnvProvisionUncached({ env: e, target: t }) {
  const root = tryGetRepoRoot()
  if (!root) {
    throw new Error(
      `not inside a qctl instance repo `
        + `(no provision/*.yaml with a qctl: block above ${process.cwd()})\n`
        + '  Run `qctl init <dir>` to scaffold one, or cd into an existing instance.',
    )
  }

  /** @type {NodeJS.ProcessEnv} */
  const processEnv = { ...process.env, QCTL_ENV: e }

  /** @type {YamlMapping} */
  let raw
  /** @type {string[]} */
  let paths
  try {
    const loaded = await loadProvision({ root, env: e, target: t, processEnv })
    raw = /** @type {YamlMapping} */ (loaded.data)
    paths = loaded.overlayPath ? [loaded.basePath, loaded.overlayPath] : [loaded.basePath]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('provision file not found')) {
      throw new Error(`${msg}\n  Create provision/${e}.yaml (see \`qctl init\`).`)
    }
    throw err
  }

  const sourceLabel = paths.map((p) => path.basename(p)).join(' + ')
  const data = parseProvisionOrThrow(raw, sourceLabel)
  for (const w of collectDisksWarnings(data.disks, { env: e })) {
    console.warn(chalk.yellow(`vm: ${w}`))
  }
  const { ports, uplinks, vlans } = data.networking
  const nets = alignProxmoxNets(uplinks, data.proxmox?.net)

  /** @type {string[]} */
  let sshList = collectSshAuthorizedKeys(data.ssh?.authorized_keys)
  if (!sshList.length) {
    const fb = fallbackSshAuthorizedKeys(paths)
    if (fb) {
      console.warn(
        chalk.yellow(`vm: no ssh.authorized_keys in provision; falling back to ${fb.source}`),
      )
      sshList = fb.keys
    }
  }

  const fromProvision = firstBootCredentialsFromProvision(data)
  const fromGuestTag = await loadHostGuestCredentials(root, processEnv)
  /** @type {FirstBootCredentials} */
  const guest = { ...fromGuestTag, ...fromProvision }

  return {
    env: e,
    target: t,
    provisionDir: getProvision(),
    path: paths.join(' + '),
    paths,
    data,
    platform: data.qctl.platform,
    sshAuthorizedKeys: sshList.length ? `${sshList.join('\n')}\n` : '',
    guest,
    local: data.local,
    proxmox: data.proxmox,
    nets,
    networking: data.networking || null,
    ports,
    uplinks,
    vlans,
    packages: data.packages,
    files: data.files,
  }
}

/**
 * Soft load: never throws for provision/schema errors.
 * Caches the first env+target; repeating the same key returns cache; a different
 * key throws (commands do not mix envs).
 *
 * @param {{ env?: string, target?: string }} [opts]
 * @returns {Promise<LoadEnvProvisionResult>}
 */
export async function loadEnvProvisionSafe({ env = 'dev', target = 'local' } = {}) {
  const e = env || 'dev'
  const t = normalizeTarget(target || 'local')
  const key = cacheKey(e, t)

  if (provisionCache) {
    if (provisionCache.key === key) return provisionCache.result
    const [cachedEnv, cachedTarget] = provisionCache.key.split('\0')
    throw new Error(
      `loadEnvProvisionSafe: already loaded env=${cachedEnv} target=${cachedTarget}; `
        + `refusing env=${e} target=${t} (clearEnvProvisionCache in tests if needed)`,
    )
  }

  try {
    const provision = await loadEnvProvisionUncached({ env: e, target: t })
    const result = /** @type {const} */ ({ ok: true, provision })
    provisionCache = { key, result }
    return result
  } catch (err) {
    const result = /** @type {const} */ ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    provisionCache = { key, result }
    return result
  }
}

/**
 * Load config for env (+ target overlay). Throws on failure.
 * @param {{ env?: string, target?: string }} [opts]
 * @returns {Promise<LoadedProvision>}
 */
export async function loadEnvProvisionOrThrow(opts = {}) {
  const r = await loadEnvProvisionSafe(opts)
  if (!r.ok) throw new Error(r.error)
  return r.provision
}

/**
 * Same as {@link loadEnvProvisionOrThrow} but prints the error and exits 1.
 * @param {{ env?: string, target?: string }} [opts]
 * @returns {Promise<LoadedProvision>}
 */
export async function loadEnvProvision(opts = {}) {
  const r = await loadEnvProvisionSafe(opts)
  if (!r.ok) return die(r.error)
  return r.provision
}
