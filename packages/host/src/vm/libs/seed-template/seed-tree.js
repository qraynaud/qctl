/**
 * Build and stage `qctl-seed/` on the NoCloud ISO (config.json + tier0/*).
 * Provision `files:` stay in cloud-init write_files (not embedded in seed config).
 */

import { z } from 'zod'
import { fs, path } from 'zx'

import {
  QCTL_SEED_CONFIG_ISO_REL,
  QCTL_SEED_ISO_DIR,
  QCTL_SEED_TIER0_ISO_REL,
  SEED_PROFILE,
  seedConfigSchema,
} from '@qctl/shared'

import {
  adminIdentityFromProvision,
  appsIdentityFromProvision,
} from '../../../provision/schema/first-boot.js'
import { vlanParentEnvLines } from '../guest-net.js'
import { disksJsonPayload } from './disks-payload.js'

/** @import { SeedConfig } from '@qctl/shared' */
/** @import { SeedVars } from './vars.js' */

/** Default until provision owns timezone (guest host-baseline applies it). */
const DEFAULT_TIMEZONE = 'Europe/Paris'

/**
 * `VLAN2_PARENT=vlan2` lines → map for seed config.
 * @param {Record<string, { ipv4?: string | null }>} vlans
 * @returns {Record<string, string>}
 */
export function vlanParentsFromVlans(vlans) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of vlanParentEnvLines(vlans || {})) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}

/**
 * Non-secret ISO config from {@link SeedVars} (buildVars context).
 * @param {SeedVars} vars
 * @returns {SeedConfig}
 */
export function buildSeedConfig(vars) {
  const apps = appsIdentityFromProvision(
    /** @type {Parameters<typeof appsIdentityFromProvision>[0]} */ (vars.provision),
  )
  const admin = adminIdentityFromProvision(vars.provision)
  const profile =
    vars.profile === SEED_PROFILE.INIT_TANK ? SEED_PROFILE.INIT_TANK : SEED_PROFILE.APPLIANCE
  const repoRaw = vars.provision.repo || {}
  const vcs = repoRaw.vcs === 'hg' ? 'hg' : 'git'
  /** @type {{ vcs: 'git' | 'hg', url?: string, branch?: string }} */
  const repo = { vcs }
  if (repoRaw.url) repo.url = String(repoRaw.url)
  if (repoRaw.branch) repo.branch = String(repoRaw.branch)

  /** @type {z.input<typeof seedConfigSchema>} */
  const raw = {
    env: vars.env,
    root: repoRaw.dir || '/tank/rocky',
    repo,
    users: {
      apps: {
        username: apps.username,
        uid: apps.uid,
        gid: apps.gid,
        subuid: apps.subuid,
        subgid: apps.subgid,
      },
      admin: {
        username: admin.username,
        uid: admin.uid,
        gid: admin.gid,
      },
    },
    disks: disksJsonPayload(vars.resolved_disks),
    ports: vars.provision.networking?.ports ?? {},
    packages: vars.provision.packages,
    vlanParents: vlanParentsFromVlans(vars.provision.networking?.vlans || {}),
    profile,
    timezone: DEFAULT_TIMEZONE,
    adminSshAuthorizedKeys: vars.admin_ssh_authorized_keys,
    tier0Keys: [...vars.guest_credential_keys],
  }
  if (profile === SEED_PROFILE.INIT_TANK) {
    const pools = String(vars.init_tank_pools || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    raw.initTank = {
      pools: pools.length ? pools : [vars.init_tank_primary_pool || 'tank'],
      primaryPool: vars.init_tank_primary_pool || pools[0] || 'tank',
      force: Boolean(vars.init_tank_force),
    }
  }
  return seedConfigSchema.parse(raw)
}

/**
 * Write `qctl-seed/config.json` + opaque `qctl-seed/tier0/<KEY>` under the ISO stage dir.
 *
 * @param {string} stageDir
 * @param {{
 *   config: SeedConfig,
 *   tier0: Record<string, string | Buffer>,
 * }} opts
 */
export async function stageSeedTree(stageDir, opts) {
  const tier0Dir = path.join(stageDir, QCTL_SEED_TIER0_ISO_REL)
  await fs.mkdirp(tier0Dir)
  await fs.mkdirp(path.join(stageDir, QCTL_SEED_ISO_DIR))
  await fs.writeFile(
    path.join(stageDir, QCTL_SEED_CONFIG_ISO_REL),
    `${JSON.stringify(opts.config, null, 2)}\n`,
  )
  for (const name of await fs.readdir(tier0Dir)) {
    await fs.remove(path.join(tier0Dir, name)).catch(() => {})
  }
  for (const [key, value] of Object.entries(opts.tier0 || {})) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
    await fs.writeFile(path.join(tier0Dir, key), buf, { mode: 0o400 })
  }
}
