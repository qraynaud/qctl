/**
 * Non-secret seed ISO config (`qctl-seed/config.json`) and OS runtime config
 * (`/etc/qctl/config.json`). Tier-0 secrets stay as raw files under
 * `qctl-seed/tier0/<KEY>` — never in these documents.
 */
import { z } from 'zod'

import { disksJsonSchema } from '../disks/disks-json.js'
import { portsSchema } from '../networking/ports.js'
import { packagesManifestSchema } from '../packages/manifest.js'
import { seedInterfacesSchema } from './interfaces.js'

/** @import { OsConfig, SeedConfig } from './config-types.js' */

/** ISO relative dir for guest binary + platform module (+ optional varlock helper). */
export const QCTL_GUEST_ISO_DIR = 'qctl-guest'

/** ISO relative dir for seed config + tier0 files. */
export const QCTL_SEED_ISO_DIR = 'qctl-seed'

/** ISO relative path of the non-secret seed config document. */
export const QCTL_SEED_CONFIG_ISO_REL = `${QCTL_SEED_ISO_DIR}/config.json`

/** ISO relative dir for opaque Tier-0 credential files. */
export const QCTL_SEED_TIER0_ISO_REL = `${QCTL_SEED_ISO_DIR}/tier0`

/** Guest on-disk non-secret runtime config (rewritten every init). */
export const QCTL_OS_CONFIG_PATH = '/etc/qctl/config.json'

/**
 * Host seed profile (ISO / cloud-init). Guest init stages use InitProfile
 * (`default` | `init-tank`); map `appliance` → `default` at init entry.
 */
export const SEED_PROFILE = Object.freeze({
  APPLIANCE: 'appliance',
  INIT_TANK: 'init-tank',
})

/** @typedef {typeof SEED_PROFILE[keyof typeof SEED_PROFILE]} SeedProfile */

export const seedProfileSchema = z.enum([SEED_PROFILE.APPLIANCE, SEED_PROFILE.INIT_TANK])

export const seedSubidRangeSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  count: z.number().int().min(1),
})

/**
 * Non-empty string with no leading/trailing whitespace.
 * Rejects padded values instead of silently trimming (host emits exact JSON).
 */
const nonEmpty = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), { message: 'must not have leading or trailing whitespace' })

export const seedAppsUserSchema = z.strictObject({
  username: nonEmpty,
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
  subuid: seedSubidRangeSchema,
  subgid: seedSubidRangeSchema,
})

/**
 * Non-secret admin identity (password stays Tier-0). Used for peercred / socket ACL.
 */
export const seedAdminUserSchema = z.strictObject({
  username: nonEmpty,
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
})

export const seedRepoSchema = z.strictObject({
  vcs: z.enum(['git', 'hg']),
  url: nonEmpty.optional(),
  branch: nonEmpty.optional(),
})

export const seedInitTankSchema = z.strictObject({
  pools: nonEmpty.array(),
  primaryPool: nonEmpty,
  force: z.boolean(),
})

/**
 * Full non-secret document on the seed ISO (`qctl-seed/config.json`).
 * Must not contain Tier-0 values (passphrases, deploy keys, admin password, …).
 */
export const seedConfigSchema = z.strictObject({
  env: nonEmpty,
  root: nonEmpty,
  repo: seedRepoSchema,
  users: z.strictObject({
    apps: seedAppsUserSchema,
    admin: seedAdminUserSchema,
  }),
  disks: disksJsonSchema,
  packages: packagesManifestSchema,
  /**
   * Guest networking — same layout as provision `networking:` (ports + interfaces).
   * Interfaces omit host-only `ethernet.vm`.
   */
  networking: z.strictObject({
    ports: portsSchema,
    interfaces: seedInterfacesSchema,
  }),
  profile: seedProfileSchema,
  /** Present when `profile` is `init-tank`; omitted for appliance. */
  initTank: seedInitTankSchema.optional(),
  timezone: nonEmpty,
  /** Multi-line authorized_keys body (public keys only). */
  adminSshAuthorizedKeys: z.string(),
  /** Tier-0 credential *names* on the ISO (values are separate raw files). */
  tier0Keys: nonEmpty.array(),
})

/**
 * Day-2 / runtime identity on the guest OS (`/etc/qctl/config.json`).
 * Strict subset of {@link seedConfigSchema} — no disks/ports/packages/secrets.
 */
export const osConfigSchema = z.strictObject({
  env: nonEmpty,
  root: nonEmpty,
  repo: seedRepoSchema,
  quadletUser: nonEmpty,
  apps: seedAppsUserSchema,
  admin: seedAdminUserSchema,
  timezone: nonEmpty,
  profile: seedProfileSchema,
})

/**
 * Materialize the OS runtime config from a parsed seed config (secrets never present).
 * @param {SeedConfig} seed
 * @returns {OsConfig}
 */
export function seedConfigToOsConfig(seed) {
  return osConfigSchema.parse({
    env: seed.env,
    root: seed.root,
    repo: seed.repo,
    quadletUser: seed.users.apps.username,
    apps: seed.users.apps,
    admin: seed.users.admin,
    timezone: seed.timezone,
    profile: seed.profile,
  })
}
