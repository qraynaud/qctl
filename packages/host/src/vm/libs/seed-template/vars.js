/**
 * Seed Nunjucks context (`buildVars`).
 */
import { chalk } from 'zx'

import { isEmptyCredential } from '@qctl/shared'

import { loadEnvSecrets } from '../../../lib/load-config.js'
import { die } from '../../../lib/util.js'
import { vlanParentEnvLines } from '../guest-net.js'
import { withTrailingNewline } from './util.js'

/** @import { NormalizedPackages } from '../../../provision/secrets-schema/packages.js' */
/**
 * @typedef {Awaited<ReturnType<typeof loadEnvSecrets>>} LoadedSecrets
 */

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

  /** @type {Record<string, string | Buffer>} */
  const guest = { ...(sec.guest || {}) }
  /** @type {string[]} */
  const missing = []
  // First-boot SoT is provision YAML → fixed Tier-0 names (host-resolved at seed).
  if (isEmptyCredential(guest.TANK_PASSPHRASE)) {
    missing.push('TANK_PASSPHRASE (provision tank.passphrase)')
  }
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
