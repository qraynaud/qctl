/**
 * Load non-secret seed config from cidata `qctl-seed/`, sync Tier-0 files to
 * pending, write `/etc/qctl/config.json`, materialize sidecars.
 * Identity stays on OsConfig / SeedConfig — not process env.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  QCTL_OS_CONFIG_PATH,
  QCTL_SEED_CONFIG_ISO_REL,
  QCTL_SEED_TIER0_ISO_REL,
  seedConfigSchema,
  seedConfigToOsConfig,
  vlanParentsFromInterfaces,
} from '@qctl/shared'

import { installFileAtomic } from './sync-from-iso.js'

/** @import { OsConfig, SeedConfig } from '@qctl/shared' */
/** @import { CidataHandle } from './cidata.js' */

/** Default Tier-0 pending dir (ISO sync → seal stage). */
export const TIER0_PENDING_DIR_DEFAULT = '/var/lib/qctl/tier0-pending'

/** Admin authorized_keys body from seed. */
export const ADMIN_SSH_KEYS_PATH_DEFAULT = '/etc/rocky/admin_ssh_authorized_keys'

/** Quadlet / day-2 VLAN parent map. */
export const VLAN_PARENTS_ENV_PATH_DEFAULT = '/usr/local/lib/rocky/vlan-parents.env'

/**
 * @typedef {object} LoadSeedResult
 * @property {SeedConfig} seed
 * @property {OsConfig} os
 * @property {string} osConfigPath
 * @property {string[]} tier0Synced Credential names copied into pending.
 * @property {Record<string, string>} secrets Tier-0 values loaded from pending for stages.
 */

/**
 * @typedef {object} LoadSeedDeps
 * @property {Record<string, string | undefined>} [env] Optional path overrides only (tests).
 * @property {(line: string) => void} [log]
 * @property {string} [osConfigPath]
 * @property {string} [tier0PendingDir]
 * @property {string} [adminKeysPath]
 * @property {string} [vlanParentsPath]
 * @property {(src: string, dest: string, mode: number) => void} [installFile]
 * @property {(seed: SeedConfig) => OsConfig} [toOsConfig]
 */

/**
 * Write admin authorized_keys + vlan-parents.env from seed (replaces prior files).
 *
 * @param {SeedConfig} seed
 * @param {{
 *   adminKeysPath?: string,
 *   vlanParentsPath?: string,
 * }} [paths]
 */
export function materializeSeedSidecars(seed, paths = {}) {
  const adminKeysPath = paths.adminKeysPath ?? ADMIN_SSH_KEYS_PATH_DEFAULT
  const vlanParentsPath = paths.vlanParentsPath ?? VLAN_PARENTS_ENV_PATH_DEFAULT

  mkdirSync(dirname(adminKeysPath), { recursive: true })
  const keysBody = seed.adminSshAuthorizedKeys.endsWith('\n')
    ? seed.adminSshAuthorizedKeys
    : `${seed.adminSshAuthorizedKeys}\n`
  writeFileSync(adminKeysPath, keysBody, { encoding: 'utf8', mode: 0o644 })

  mkdirSync(dirname(vlanParentsPath), { recursive: true })
  const lines = Object.entries(vlanParentsFromInterfaces(seed.networking.interfaces))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
  writeFileSync(vlanParentsPath, lines.length ? `${lines.join('\n')}\n` : '', {
    encoding: 'utf8',
    mode: 0o644,
  })
}

/**
 * Parse ISO `qctl-seed/config.json`.
 *
 * @param {string} configPath Absolute path to config.json
 * @returns {SeedConfig}
 */
export function parseSeedConfigFile(configPath) {
  let raw
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(
      `failed to read seed config ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return seedConfigSchema.parse(raw)
}

/**
 * Load Tier-0 pending files into a secrets map.
 * Valid utf8 → string (strip one trailing newline). Non-utf8 → base64 text.
 *
 * @param {string} pendingDir
 * @returns {Record<string, string>}
 */
export function loadSecretsFromTier0Pending(pendingDir) {
  /** @type {Record<string, string>} */
  const secrets = {}
  if (!pendingDir || !existsSync(pendingDir)) return secrets
  let names
  try {
    names = readdirSync(pendingDir)
  } catch {
    return secrets
  }
  for (const name of names) {
    if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) continue
    const p = join(pendingDir, name)
    let buf
    try {
      buf = readFileSync(p)
    } catch {
      continue
    }
    if (!buf.length) continue
    const asUtf8 = buf.toString('utf8')
    const validUtf8 = Buffer.from(asUtf8, 'utf8').equals(buf)
    if (validUtf8) {
      let s = asUtf8
      if (s.endsWith('\r\n')) s = s.slice(0, -2)
      else if (s.endsWith('\n') || s.endsWith('\r')) s = s.slice(0, -1)
      if (!s) continue
      secrets[name] = s
    } else {
      secrets[name] = buf.toString('base64')
    }
  }
  return secrets
}

/**
 * Copy opaque `qctl-seed/tier0/<KEY>` → pending dir (mode 0400).
 *
 * @param {string} tier0IsoDir
 * @param {string} pendingDir
 * @param {{
 *   installFile?: (src: string, dest: string, mode: number) => void,
 *   expectedKeys?: string[],
 * }} [opts]
 * @returns {string[]} synced key names (sorted)
 */
export function syncTier0Pending(tier0IsoDir, pendingDir, opts = {}) {
  const install = opts.installFile ?? installFileAtomic
  mkdirSync(pendingDir, { recursive: true })

  /** @type {string[]} */
  let names
  try {
    names = readdirSync(tier0IsoDir).filter((n) => n && !n.startsWith('.'))
  } catch (err) {
    throw new Error(
      `failed to read tier0 dir ${tier0IsoDir}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  /** @type {string[]} */
  const synced = []
  for (const name of names) {
    install(join(tier0IsoDir, name), join(pendingDir, name), 0o400)
    synced.push(name)
  }
  synced.sort()

  if (opts.expectedKeys) {
    const have = new Set(synced)
    const missing = opts.expectedKeys.filter((k) => !have.has(k))
    if (missing.length) {
      throw new Error(`seed tier0Keys missing on ISO under ${tier0IsoDir}: ${missing.join(', ')}`)
    }
  }
  return synced
}

/**
 * Write non-secret OS runtime config (replaces any previous file).
 *
 * @param {OsConfig} os
 * @param {string} [path]
 */
export function writeOsConfig(os, path = QCTL_OS_CONFIG_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(os, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 })
}

/**
 * Load seed from an open cidata handle: parse config, sync tier0, write OS config.
 *
 * @param {Pick<CidataHandle, 'root' | 'seedDir'>} cidata
 * @param {LoadSeedDeps} deps
 * @returns {LoadSeedResult}
 */
export function loadSeedFromIso(cidata, deps) {
  const log = deps.log ?? (() => {})
  const toOs = deps.toOsConfig ?? seedConfigToOsConfig
  const install = deps.installFile ?? installFileAtomic
  const env = deps.env ?? {}
  const osConfigPath = deps.osConfigPath ?? env.QCTL_OS_CONFIG?.trim() ?? QCTL_OS_CONFIG_PATH
  const tier0PendingDir =
    deps.tier0PendingDir ?? env.ROCKY_TIER0_PENDING?.trim() ?? TIER0_PENDING_DIR_DEFAULT

  const configPath = join(cidata.root, QCTL_SEED_CONFIG_ISO_REL)
  const tier0IsoDir = join(cidata.root, QCTL_SEED_TIER0_ISO_REL)

  const seed = parseSeedConfigFile(configPath)
  const tier0Synced = syncTier0Pending(tier0IsoDir, tier0PendingDir, {
    installFile: install,
    expectedKeys: seed.tier0Keys,
  })
  const os = toOs(seed)
  writeOsConfig(os, osConfigPath)
  materializeSeedSidecars(seed, {
    adminKeysPath:
      deps.adminKeysPath ?? env.ROCKY_ADMIN_SSH_KEYS?.trim() ?? ADMIN_SSH_KEYS_PATH_DEFAULT,
    vlanParentsPath:
      deps.vlanParentsPath ?? env.QCTL_VLAN_PARENTS_ENV?.trim() ?? VLAN_PARENTS_ENV_PATH_DEFAULT,
  })
  const secrets = loadSecretsFromTier0Pending(tier0PendingDir)

  log(
    `qctl load-seed: ${configPath} → ${osConfigPath}`
      + ` (tier0 pending: ${tier0Synced.length} key(s), secrets: ${Object.keys(secrets).length})`,
  )

  return { seed, os, osConfigPath, tier0Synced, secrets }
}
