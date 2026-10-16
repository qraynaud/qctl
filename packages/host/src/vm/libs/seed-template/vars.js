/**
 * Seed Nunjucks context (`buildVars`).
 */
import { chalk } from 'zx'

import { isEmptyCredential } from '@qctl/shared'

import { loadEnvProvision } from '../../../lib/load-config.js'
import { die } from '../../../lib/util.js'
import { tankPassphraseCredName } from '../../../provision/schema/first-boot.js'
import { vlanParentEnvLines } from '../guest-net.js'
import { resolveProvisionDisks } from '../resolve-provision-disks.js'
import { withTrailingNewline } from './util.js'

/** @import { LoadedProvision } from '../../../lib/load-config-types.js' */
/** @import { NormalizedPackages } from '../../../provision/schema/packages.js' */
/** @import { ResolvedDisks } from '../../../provision/schema/resolve-disks.js' */

/**
 * One seed context for all !template / !file renders.
 * YAML lives under `provision.*` so seed-only keys cannot clobber it.
 *
 * @param {{
 *   instanceId: string,
 *   allowMissingTier0?: boolean,
 *   env?: string,
 *   target?: string,
 *   provision?: LoadedProvision | null,
 *   profile?: string,
 *   initTankPools?: string[],
 *   initTankForce?: boolean,
 * }} opts
 */
export async function buildVars({
  instanceId,
  allowMissingTier0,
  env = 'dev',
  target = 'local',
  provision = null,
  profile = 'appliance',
  initTankPools,
  initTankForce = false,
}) {
  const sec = provision || (await loadEnvProvision({ env, target }))

  if (!sec.sshAuthorizedKeys) {
    die(
      `no admin SSH public key `
        + `(set ssh.authorized_keys in provision/${env}.yaml, `
        + `or place id_ed25519.pub / id_rsa.pub in ~/.ssh)`,
    )
  }

  /** @type {ResolvedDisks} */
  const resolvedDisks = await resolveProvisionDisks({ env, target, provision: sec })

  /** @type {Record<string, string | Buffer | undefined>} */
  const guest = { ...(sec.guest || {}) }
  /** @type {string[]} */
  const missing = []
  // Encrypted tanks → Tier-0 tank_passphrase_<poolId> (from disks.tanks.*.passphrase).
  for (const poolId of resolvedDisks.encryptedTankIds) {
    const key = tankPassphraseCredName(poolId)
    if (isEmptyCredential(guest[key])) {
      missing.push(`${key} (disks.tanks.*.passphrase for pool ${poolId})`)
    }
  }
  if (missing.length && !allowMissingTier0) {
    die(`missing first-boot Tier-0 (${missing.join(', ')}) (or pass --allow-missing-tier0)`)
  }
  if (missing.length) {
    console.warn(chalk.yellow(`vm seed: omitting Tier-0 (${missing.join(', ')})`))
  }

  /** @type {Record<string, string | Buffer>} */
  const guestForSeed = {}
  for (const [key, value] of Object.entries(guest)) {
    if (isEmptyCredential(value)) continue
    if (Buffer.isBuffer(value)) {
      guestForSeed[key] = value
      continue
    }
    const withNl = withTrailingNewline(value)
    if (withNl) guestForSeed[key] = withNl
  }

  // Clone stage: VCS (git default) + optional branch / topic / rev.
  const repo = sec.data.repo
  const repoVcs = repo?.vcs === 'hg' ? 'hg' : 'git'
  const repoBranch =
    repo?.branch != null && String(repo.branch).trim() !== ''
      ? String(repo.branch).trim()
      : undefined
  /** @type {NormalizedPackages} */
  const packages = sec.packages || { distro: [], pipx: [], http: [] }

  // Shallow copy of parsed provision; pin networking / guest / repo / packages.
  const data = {
    ...sec.data,
    guest: guestForSeed,
    networking: {
      ...sec.data.networking,
      ports: sec.ports,
      uplinks: sec.uplinks,
      vlans: sec.vlans,
    },
    repo: {
      ...(repo && typeof repo === 'object' ? repo : {}),
      vcs: repoVcs,
      branch: repoBranch,
    },
    packages,
  }

  const parentLines = vlanParentEnvLines(sec.vlans)
  const guestKeys = Object.keys(guestForSeed).sort()
  const seedProfile = profile === 'init-tank' ? 'init-tank' : 'appliance'
  const pools =
    Array.isArray(initTankPools) && initTankPools.length
      ? initTankPools.map((p) => String(p).trim()).filter(Boolean)
      : Object.values(resolvedDisks.tanks || {}).map((t) => t.id)
  const ctx = {
    provision: data,
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
    /** Canonical disks for seed inject (passphrases stay in Tier-0 only). */
    resolved_disks: resolvedDisks,
    /** init-tank: comma-separated pool ids for guest zpool create. */
    init_tank_pools: pools.join(','),
    init_tank_primary_pool: pools[0] || 'tank',
    init_tank_force: Boolean(initTankForce),
  }

  console.log(chalk.dim(`  provision: ${sec.path}`))
  console.log(chalk.dim(`  provision.networking.ports: ${Object.keys(sec.ports).join(', ')}`))
  console.log(
    chalk.dim(
      `  provision.networking.uplinks: ${Object.keys(sec.uplinks).join(', ')}`
        + (Object.keys(sec.vlans).length
          ? `; vlans: ${Object.entries(sec.vlans)
              .map(([name, v]) => `${name}(id=${v.id}@${v.link}${v.ipv4 ? `;ipv4=${v.ipv4}` : ''})`)
              .join(', ')}`
          : ''),
    ),
  )
  if (guestKeys.length) {
    console.log(chalk.dim(`  @tag(guest): ${guestKeys.join(', ')}`))
  }
  console.log(chalk.dim(`  provision.repo.vcs: ${repoVcs}`))
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
  if (repoBranch) console.log(chalk.dim(`  provision.repo.branch: ${repoBranch}`))
  return ctx
}
