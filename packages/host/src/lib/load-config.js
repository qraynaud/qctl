/**
 * VM config: `provision/<env>.yaml` (+ `<env>.<target>.yaml`) via
 * `@qctl/shared` `loadProvision` (`!env` from process.env /
 * `provision/.env.<env>` via loadHostEnv), then zod-validated by the secrets
 * schema. Tier-0 credentials come from provision YAML
 * (`tank` / `admin` / `repo.deploy_key` / …) via `!env`. Optional extra
 * `@tag(guest)` keys are still sealed. Admin SSH pubkeys: `ssh.authorized_keys`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { chalk, path } from 'zx'

import { loadHostGuestCredentials, loadProvision } from '@qctl/shared'

import {
  firstBootCredentialsFromProvision,
  parseSecretsFile,
} from '../provision/secrets-schema/index.js'
import { getProvision, tryGetRepoRoot } from './paths.js'
import { TARGETS } from './target.js'
import { die } from './util.js'

/** @import { YamlMapping } from '@qctl/shared' */
/** @import { FirstBootCredentials } from '../provision/secrets-schema/first-boot.js' */

/** Preferred pubkey filenames (ed25519 first). */
const SSH_PUB_CANDIDATES = ['id_ed25519.pub', 'id_rsa.pub']

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
  // Prefer HOME so tests (and unusual shells) can redirect without touching the real home.
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
 * Load config for env (+ target overlay) from the instance `provision/`.
 * Throws on missing instance/file, unresolved `!env`, or schema errors.
 * Use {@link loadEnvSecrets} from command handlers to exit instead.
 *
 * @param {{ env?: string, target?: string }} [opts]
 */
export async function loadEnvSecretsOrThrow({ env = 'dev', target = 'local' } = {}) {
  const e = env || 'dev'
  const t = /** @type {"local" | "proxmox"} */ (
    /** @type {readonly string[]} */ (TARGETS).includes(target) ? target : 'local'
  )

  const root = tryGetRepoRoot()
  if (!root) {
    throw new Error(
      `not inside a qctl instance repo (no provision/*.yaml with a qctl: block above ${process.cwd()})\n`
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

  /** @type {string | null} */
  let platform = null
  const qctl = raw.qctl
  if (qctl && typeof qctl === 'object' && !Array.isArray(qctl)) {
    const q = /** @type {YamlMapping} */ (qctl)
    if (typeof q.platform === 'string' && q.platform.trim()) {
      platform = q.platform.trim()
    } else if (
      q.tooling
      && typeof q.tooling === 'object'
      && !Array.isArray(q.tooling)
      && typeof (/** @type {YamlMapping} */ (q.tooling).platform) === 'string'
    ) {
      // Legacy `qctl.tooling.platform: rocky@x.y.z` — prefer new `qctl.platform`.
      platform = String(/** @type {YamlMapping} */ (q.tooling).platform).trim()
      console.warn(
        chalk.yellow(
          'vm: qctl.tooling.platform is deprecated; use qctl.platform'
            + ' (e.g. platform: rocky or github:owner/repo)',
        ),
      )
    }
    delete raw.qctl
  }

  const sourceLabel = paths.map((p) => path.basename(p)).join(' + ')
  const parsed = parseSecretsFile(raw, sourceLabel)
  const { data, ports, uplinks, vlans, nets, local, proxmox, packages, files } = parsed

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

  // First-boot secrets from provision YAML (!env-resolved) + optional @tag(guest) extras.
  const fromProvision = firstBootCredentialsFromProvision(data)
  const fromGuestTag = await loadHostGuestCredentials(root, processEnv)
  /** @type {FirstBootCredentials & Record<string, string | Buffer>} */
  const guest = { ...fromGuestTag, ...fromProvision }

  return {
    env: e,
    target: t,
    /** Directory of provision YAML (for logs / seed context). */
    provisionDir: getProvision(),
    path: paths.join(' + '),
    paths,
    data,
    /** From `qctl.platform` (stripped from `data`); short name or github:owner/repo. */
    platform,
    sshAuthorizedKeys: sshList.length ? `${sshList.join('\n')}\n` : '',
    /** Tier-0 pending: provision first-boot slots + optional `@tag(guest)` extras. */
    guest,
    local,
    proxmox,
    nets,
    networking: data.networking || null,
    ports,
    uplinks,
    vlans,
    /** Normalized `packages.{distro,pipx,http}` (VCS mercurial applied at appliance seed). */
    packages: packages ?? { distro: [], pipx: [], http: [] },
    /** Normalized `files:` → cloud-init write_files (VCS hgrc applied at appliance seed). */
    files: files ?? [],
  }
}

/**
 * Same as {@link loadEnvSecretsOrThrow} but prints the error and exits 1.
 * @param {Parameters<typeof loadEnvSecretsOrThrow>[0]} [opts]
 */
export async function loadEnvSecrets(opts) {
  try {
    return await loadEnvSecretsOrThrow(opts)
  } catch (err) {
    return die(err instanceof Error ? err.message : String(err))
  }
}
