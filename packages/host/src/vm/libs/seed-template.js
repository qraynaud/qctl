/**
 * NoCloud YAML template resolution (!template / !file) with Nunjucks.
 *
 * Seed context (same shape in every template):
 *   secrets — provision/<env>.yaml (+ optional <env>.<target>.yaml) mapping
 *   env, instance_id, local_hostname, admin_ssh_authorized_keys — seed-only
 *
 * !template — inline Nunjucks (empty → omit write_files entry)
 * !file     — embed seed-kit/<path>; Nunjucks only if file has {{ or {%
 */
import nunjucks from 'nunjucks'
import YAML from 'yaml'
import { chalk, fs, path } from 'zx'

import { vlanParentEnvLines } from './guest-net.js'
import { loadEnvSecrets } from './load-config.js'
import { getSeedKit } from './paths.js'
import { die } from './util.js'

/** @import { Environment } from 'nunjucks' */
/** @import { YamlMapping, YamlValue } from '@qctl/shared' */
/** @import { NormalizedPackages } from './secrets-schema/packages.js' */

/** @typedef {Awaited<ReturnType<typeof loadEnvSecrets>>} LoadedSecrets */
/** @typedef {YamlMapping} CloudConfig */
/** @typedef {Awaited<ReturnType<typeof buildVars>>} SeedVars */
/**
 * Parsed seed YAML while `OMIT` sentinels may still be present.
 * @typedef {YamlValue | typeof OMIT | SeedNode[] | { [key: string]: SeedNode }} SeedNode
 */
/** @typedef {{ path?: string, content?: SeedNode } & YamlMapping} CloudWriteFile */

/** Sentinel: drop write_files entries whose content resolved to this. */
export const OMIT = Symbol('omit')

/**
 * @param {string | null | undefined} s
 * @returns {string | null}
 */
function withTrailingNewline(s) {
  if (s == null || s === '') return null
  const t = String(s)
  return t.endsWith('\n') ? t : `${t}\n`
}

/** @type {{ root: string, env: Environment } | null} */
let njkCache = null

/**
 * Nunjucks env rooted at the Rocky seed kit (created lazily per root).
 * @returns {Environment}
 */
function getNjk() {
  const root = getSeedKit()
  if (njkCache?.root === root) return njkCache.env
  const env = nunjucks.configure(root, {
    autoescape: false,
    throwOnUndefined: true,
    noCache: true,
    tags: {
      blockStart: '{%',
      blockEnd: '%}',
      variableStart: '{{',
      variableEnd: '}}',
      commentStart: '[#',
      commentEnd: '#]',
    },
  })
  /** list | named('ssh') → entry with that name, or null */
  env.addFilter('named', (/** @type {YamlValue} */ list, /** @type {string} */ name) => {
    if (!Array.isArray(list)) return null
    return (
      list.find(
        (p) =>
          p
          && typeof p === 'object'
          && !Array.isArray(p)
          && /** @type {YamlMapping} */ (p).name === name,
      ) || null
    )
  })
  njkCache = { root, env }
  return env
}

/**
 * One seed context for all !template / !file renders.
 * YAML lives under `secrets.*` so seed-only keys cannot clobber it.
 *
 * @param {{
 *   instanceId: string,
 *   allowMissingTier0?: boolean,
 *   env?: string,
 *   target?: string,
 *   secrets?: LoadedSecrets | null,
 *   profile?: string,
 * }} opts
 */
export async function buildVars({
  instanceId,
  allowMissingTier0,
  env = 'dev',
  target = 'local',
  secrets = null,
  profile = 'appliance',
}) {
  const sec = secrets || (await loadEnvSecrets({ env, target }))

  if (!sec.sshAuthorizedKeys) {
    die(
      `no admin SSH public key `
        + `(set ssh.authorized_keys in provision/${env}.yaml, `
        + `or place id_ed25519.pub / id_rsa.pub in ~/.ssh)`,
    )
  }

  /** @type {Record<string, string>} */
  const guest = { ...(sec.guest || {}) }
  /** @type {string[]} */
  const missing = []
  // First-boot SoT is provision YAML → fixed Tier-0 names (host-resolved at seed).
  if (!guest.TANK_PASSPHRASE) missing.push('TANK_PASSPHRASE (provision tank.passphrase)')
  if (missing.length && !allowMissingTier0) {
    die(`missing first-boot Tier-0 (${missing.join(', ')}) (or pass --allow-missing-tier0)`)
  }
  if (missing.length) {
    console.warn(chalk.yellow(`vm seed: omitting Tier-0 (${missing.join(', ')})`))
  }

  // Copy secrets YAML; pin normalized networking.* + guest/tank.
  const data = structuredClone(sec.data) || {}
  data.networking = {
    ...(typeof data.networking === 'object' && data.networking && !Array.isArray(data.networking)
      ? data.networking
      : {}),
    ports: sec.ports,
    uplinks: sec.uplinks,
    vlans: sec.vlans,
  }
  /** @type {Record<string, string>} */
  const guestForSeed = {}
  for (const [key, value] of Object.entries(guest)) {
    const withNl = withTrailingNewline(value)
    if (withNl) guestForSeed[key] = withNl
  }
  data.guest = guestForSeed
  // Clone stage: VCS (git default) + optional branch / topic / rev.
  const repoVcs = data.repo?.vcs === 'hg' ? 'hg' : 'git'
  const repoBranch =
    data.repo?.branch != null && String(data.repo.branch).trim() !== ''
      ? String(data.repo.branch).trim()
      : null
  data.repo = {
    ...(typeof data.repo === 'object' && data.repo && !Array.isArray(data.repo) ? data.repo : {}),
    vcs: repoVcs,
    branch: repoBranch,
  }
  /** @type {NormalizedPackages} */
  const packages = sec.packages || { distro: [], pipx: [], http: [] }
  data.packages = /** @type {typeof data.packages} */ (packages)

  const parentLines = vlanParentEnvLines(sec.vlans)
  const guestKeys = Object.keys(guestForSeed).sort()
  const seedProfile = profile === 'init-tank' ? 'init-tank' : 'appliance'
  const ctx = {
    secrets: data,
    env: sec.env,
    instance_id: instanceId,
    local_hostname: 'rocky',
    admin_ssh_authorized_keys: sec.sshAuthorizedKeys,
    /** `appliance` | `init-tank` — switches deltas in the shared user-data.yaml */
    profile: seedProfile,
    is_init_tank: seedProfile === 'init-tank',
    // Empty → !template omits write_files entry for vlan-parents.env
    vlan_parent_env: parentLines.length ? `${parentLines.join('\n')}\n` : '',
    /** Sorted Tier-0 keys (provision → guest) for LoadCredentialEncrypted templates. */
    guest_credential_keys: guestKeys,
    has_guest_credentials: guestKeys.length > 0,
  }

  console.log(chalk.dim(`  secrets: ${sec.path}`))
  console.log(chalk.dim(`  secrets.networking.ports: ${sec.ports.map((p) => p.name).join(', ')}`))
  console.log(
    chalk.dim(
      `  secrets.networking.uplinks: ${sec.uplinks.map((u) => u.name).join(', ')}`
        + (sec.vlans.length
          ? `; vlans: ${sec.vlans
              .map((v) => `${v.name}(id=${v.id}@${v.link}${v.ipv4 ? `;ipv4=${v.ipv4}` : ''})`)
              .join(', ')}`
          : ''),
    ),
  )
  if (guestKeys.length) {
    console.log(chalk.dim(`  @tag(guest): ${guestKeys.join(', ')}`))
  }
  console.log(chalk.dim(`  secrets.repo.vcs: ${repoVcs}`))
  if (packages.distro?.length) {
    console.log(chalk.dim(`  packages.distro: ${packages.distro.join(', ')}`))
  }
  if (packages.pipx?.length) {
    console.log(chalk.dim(`  packages.pipx: ${packages.pipx.map((p) => p.package).join(', ')}`))
  }
  if (packages.http?.length) {
    console.log(
      chalk.dim(
        `  packages.http: ${packages.http.map((p) => p.bin || p.dest || p.url).join(', ')}`,
      ),
    )
  }
  const files = sec.files || []
  if (files.length) {
    console.log(chalk.dim(`  files: ${files.map((f) => f.path).join(', ')}`))
  }
  if (repoBranch) console.log(chalk.dim(`  secrets.repo.branch: ${repoBranch}`))
  return ctx
}

const TIER0_PENDING_PREFIX = '/var/lib/rocky/tier0-pending/'

/**
 * Embed every `@tag(guest)` value as a Tier-0 pending write_files entry
 * (`/var/lib/rocky/tier0-pending/<KEY>`). Replaces any prior entry for the same path.
 *
 * @param {CloudConfig} userData parsed cloud-config
 * @param {Record<string, string> | undefined} guest
 */
export function injectGuestCredentialFiles(userData, guest) {
  if (!userData || typeof userData !== 'object') return userData
  const entries = Object.entries(guest || {}).filter(([, v]) => v != null && String(v) !== '')
  if (!entries.length) return userData

  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  /** @type {Set<string | undefined>} */
  const drop = new Set(entries.map(([key]) => `${TIER0_PENDING_PREFIX}${key}`))
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && drop.has(w.path)))
  for (const [key, value] of entries) {
    kept.push({
      path: `${TIER0_PENDING_PREFIX}${key}`,
      owner: 'root:root',
      permissions: '0400',
      content: withTrailingNewline(value),
    })
  }
  userData.write_files = kept
  return userData
}

const PACKAGES_JSON_PATH = '/usr/local/lib/rocky/packages.json'

/**
 * Embed normalized `packages` (distro / pipx / http) for cloud-init
 * `install-packages.sh`.
 *
 * @param {CloudConfig} userData
 * @param {NormalizedPackages | undefined} packages
 */
export function injectPackagesManifest(userData, packages) {
  if (!userData || typeof userData !== 'object') return userData
  const body = {
    distro: packages?.distro || [],
    pipx: packages?.pipx || [],
    http: packages?.http || [],
  }
  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  const kept = writeFiles.filter(
    (w) => !(w && typeof w === 'object' && w.path === PACKAGES_JSON_PATH),
  )
  kept.push({
    path: PACKAGES_JSON_PATH,
    owner: 'root:root',
    permissions: '0644',
    content: `${JSON.stringify(body, null, 2)}\n`,
  })
  userData.write_files = kept
  return userData
}

/**
 * Merge provision `files:` into cloud-init `write_files` (replaces same path).
 * Ensures content ends with a newline.
 *
 * @param {CloudConfig} userData
 * @param {{ path: string, owner?: string, permissions?: string, content: string }[] | undefined} files
 */
export function injectProvisionFiles(userData, files) {
  if (!userData || typeof userData !== 'object') return userData
  const list = Array.isArray(files) ? files : []
  if (!list.length) return userData

  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  /** @type {Set<string | undefined>} */
  const drop = new Set(list.map((f) => f.path).filter(Boolean))
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && drop.has(w.path)))
  for (const f of list) {
    if (!f?.path) continue
    const body = String(f.content ?? '')
    kept.push({
      path: f.path,
      owner: f.owner || 'root:root',
      permissions: f.permissions || '0644',
      content: body.endsWith('\n') ? body : `${body}\n`,
    })
  }
  userData.write_files = kept
  return userData
}

/**
 * @param {string} rel
 * @returns {string}
 */
function fileStub(rel) {
  return [
    '#!/usr/bin/env bash',
    `# Placeholder — seed-kit/${rel} not available`,
    'set -euo pipefail',
    `echo "rocky: stub for seed-kit/${rel}" >&2`,
    '',
  ].join('\n')
}

/**
 * @param {string} rel
 * @returns {string}
 */
function unitStub(rel) {
  return [
    '[Unit]',
    `Description=Stub — add seed-kit/${rel}`,
    '[Service]',
    'Type=oneshot',
    'ExecStart=/bin/true',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

/**
 * @param {string} out
 * @returns {string | typeof OMIT}
 */
function emptyToOmit(out) {
  return out.trim() === '' ? OMIT : out
}

/**
 * Render seed-kit/<rel> (Nunjucks via path so {% include %} works).
 * @param {string} rel
 * @param {SeedVars} ctx
 * @returns {string | typeof OMIT | null}
 */
export function renderProvisionFile(rel, ctx) {
  const abs = path.join(getSeedKit(), rel)
  if (!fs.existsSync(abs)) return null
  const raw = fs.readFileSync(abs, 'utf8')
  if (!/\{\{|\{%/.test(raw)) return raw
  try {
    return emptyToOmit(getNjk().render(rel, ctx))
  } catch (err) {
    die(`nunjucks seed-kit/${rel}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * @param {string | null | undefined} src
 * @param {SeedVars} ctx
 * @returns {string | typeof OMIT}
 */
function resolveTemplate(src, ctx) {
  const body = String(src ?? '')
  try {
    const out = emptyToOmit(getNjk().renderString(body, ctx))
    console.log(chalk.dim(out === OMIT ? '  !template (omit)' : '  !template'))
    return out
  } catch (err) {
    die(`nunjucks !template: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * @param {SeedVars} ctx
 * @param {boolean | undefined} allowMissingFiles
 */
function createCustomTags(ctx, allowMissingFiles) {
  return [
    {
      tag: '!template',
      /** @param {string} src */
      resolve(src) {
        return resolveTemplate(src, ctx)
      },
    },
    {
      tag: '!file',
      /** @param {string} rel */
      resolve(rel) {
        const rendered = renderProvisionFile(rel, ctx)
        if (rendered === OMIT) {
          console.log(chalk.dim(`  !file ${rel} (omit)`))
          return OMIT
        }
        if (rendered != null) {
          console.log(chalk.dim(`  !file ${rel}`))
          return rendered
        }
        if (!allowMissingFiles) {
          die(`missing !file seed-kit/${rel} (or pass --allow-missing-files)`)
        }
        console.warn(chalk.yellow(`vm seed: stub !file seed-kit/${rel}`))
        return rel.endsWith('.service') || rel.endsWith('.timer') ? unitStub(rel) : fileStub(rel)
      },
    },
  ]
}

/**
 * Recursively drop OMIT sentinels from a parsed YAML tree (mutates objects).
 * @param {SeedNode} node
 * @returns {SeedNode}
 */
function pruneOmits(node) {
  if (node === OMIT) return OMIT
  if (Array.isArray(node)) {
    return node.map(pruneOmits).filter((x) => x !== OMIT)
  }
  if (node && typeof node === 'object') {
    const rec = /** @type {{ [key: string]: SeedNode }} */ (node)
    if (Array.isArray(rec.write_files)) {
      rec.write_files = rec.write_files.filter(
        (w) => w && typeof w === 'object' && !Array.isArray(w) && w.content !== OMIT,
      )
    }
    for (const [k, v] of Object.entries(rec)) {
      const next = pruneOmits(v)
      if (next === OMIT) delete rec[k]
      else rec[k] = next
    }
  }
  return node
}

/**
 * @param {string} filePath
 * @param {SeedVars} vars
 * @param {boolean | undefined} allowMissingFiles
 * @returns {CloudConfig}
 */
export function renderTemplate(filePath, vars, allowMissingFiles) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const doc = /** @type {SeedNode} */ (
    YAML.parse(raw, { customTags: createCustomTags(vars, allowMissingFiles) })
  )
  return /** @type {CloudConfig} */ (pruneOmits(doc))
}
