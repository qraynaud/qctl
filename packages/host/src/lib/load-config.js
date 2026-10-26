/**
 * VM config: provision YAML layers via `@qctl/shared` `loadProvision`
 * (common → target-* → env-* → profile-*; `!env` from process.env /
 * `provision/.env.<env>` via loadHostEnv), then zod-validated by the provision
 * schema. Tier-0 credentials come from provision YAML
 * (`tank` / `admin` / `repo.deploy_key` / …) via `!env`. Optional extra
 * `@tag(guest)` keys are still sealed. Admin SSH pubkeys: `ssh.authorized_keys`.
 *
 * Prefer {@link loadEnvProvisionSafe} for soft paths; {@link loadEnvProvision}
 * dies on failure. One successful profile (+ instance root) per process
 * lifetime (cached); failures are not cached. Call
 * {@link clearEnvProvisionCache} in tests.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { chalk, path } from 'zx'

import { loadHostGuestCredentials, loadProvision } from '@qctl/shared'

import {
  alignedVmNics,
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
 * Single-flight cache: one profile per process (commands never mix).
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
 * @returns {"workstation" | "proxmox"}
 */
function normalizeTarget(target) {
  return /** @type {"workstation" | "proxmox"} */ (
    /** @type {readonly string[]} */ (TARGETS).includes(target) ? target : 'workstation'
  )
}

/**
 * @param {string} profile
 * @param {string} e
 * @param {"workstation" | "proxmox"} t
 * @returns {string}
 */
function cacheKey(profile, e, t) {
  return `${profile}\0${e}\0${t}`
}

/**
 * Uncached load (throws). Used only by {@link loadEnvProvisionSafe}.
 * @param {{ env: string, target: "workstation" | "proxmox", profile: string }} opts
 * @returns {Promise<LoadedProvision>}
 */
async function loadEnvProvisionUncached({ env: e, target: t, profile: p }) {
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
    const loaded = await loadProvision({ root, env: e, target: t, profile: p, processEnv })
    raw = /** @type {YamlMapping} */ (loaded.data)
    paths = [
      ...(loaded.commonPath ? [loaded.commonPath] : []),
      ...(loaded.targetPath ? [loaded.targetPath] : []),
      ...(loaded.envPath ? [loaded.envPath] : []),
      ...(loaded.profilePath ? [loaded.profilePath] : []),
    ]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('no provision YAML found')) {
      throw new Error(
        `${msg}\n  Create at least one of `
          + `provision/{common.yaml,target-${t}.yaml,env-${e}.yaml,profile-${p}.yaml} `
          + '(see `qctl init`).',
      )
    }
    throw err
  }

  const sourceLabel = paths.map((pathName) => path.basename(pathName)).join(' + ')
  const data = parseProvisionOrThrow(raw, sourceLabel)
  for (const w of collectDisksWarnings(data.disks, {
    env: e,
    environments: data.qctl.environments,
  })) {
    console.warn(chalk.yellow(`vm: ${w}`))
  }
  const { ports, interfaces } = data.networking
  const nets = alignedVmNics(interfaces)

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
    profile: p,
    provisionDir: getProvision(),
    path: paths.join(' + '),
    paths,
    data,
    platform: data.qctl.platform,
    sshAuthorizedKeys: sshList.length ? `${sshList.join('\n')}\n` : '',
    guest,
    workstation: data.workstation,
    proxmox: data.proxmox,
    nets,
    networking: data.networking || null,
    ports,
    interfaces,
    packages: data.packages,
    files: data.files,
  }
}

/**
 * Soft load: never throws for provision/schema errors.
 * Caches the first successful profile (+ instance root); repeating the same
 * key returns cache; a different key throws (commands do not mix profiles).
 * Failures are not cached — they are often cwd / missing-instance transients
 * (poisoning later loads in the same process, e.g. bun test workers).
 *
 * @param {{ env?: string, target?: string, profile: string }} opts
 * @returns {Promise<LoadEnvProvisionResult>}
 */
export async function loadEnvProvisionSafe(opts) {
  const env = opts?.env
  const target = opts?.target
  const profile = opts?.profile
  if (profile == null || String(profile).trim() === '') {
    throw new Error('loadEnvProvisionSafe: profile is required')
  }
  const e = env || 'dev'
  const t = normalizeTarget(target || 'workstation')
  const p = String(profile).trim()
  const root = tryGetRepoRoot()
  const key = `${root ?? ''}\0${cacheKey(p, e, t)}`

  if (provisionCache) {
    if (provisionCache.key === key) return provisionCache.result
    const parts = provisionCache.key.split('\0')
    const cachedProfile = parts[1] ?? '?'
    throw new Error(
      `loadEnvProvisionSafe: already loaded profile=${cachedProfile}; `
        + `refusing profile=${p} (clearEnvProvisionCache in tests if needed)`,
    )
  }

  try {
    const provision = await loadEnvProvisionUncached({ env: e, target: t, profile: p })
    const result = /** @type {const} */ ({ ok: true, provision })
    provisionCache = { key, result }
    return result
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Load config for a profile. Throws on failure.
 * @param {{ env?: string, target?: string, profile: string }} opts
 * @returns {Promise<LoadedProvision>}
 */
export async function loadEnvProvisionOrThrow(opts) {
  const r = await loadEnvProvisionSafe(opts)
  if (!r.ok) throw new Error(r.error)
  return r.provision
}

/**
 * Same as {@link loadEnvProvisionOrThrow} but prints the error and exits 1.
 * @param {{ env?: string, target?: string, profile: string }} opts
 * @returns {Promise<LoadedProvision>}
 */
export async function loadEnvProvision(opts) {
  const r = await loadEnvProvisionSafe(opts)
  if (!r.ok) return die(r.error)
  return r.provision
}
