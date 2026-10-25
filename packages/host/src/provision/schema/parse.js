import { z } from 'zod'

import {
  enrichQctlHostMetaFields,
  qctlHostMetaFieldsSchema,
  refineQctlHostMeta,
} from '@qctl/shared'

import { getDriverModule, listDriverIds } from '../../vm/drivers/registry.js'
import { disksSchema } from './disks.js'
import { filesSchema } from './files.js'
import { registriesSchema } from './first-boot.js'
import { networkingSchema } from './networking.js'
import { packagesFieldSchema } from './packages.js'
import { proxmoxSchema, workstationSchema } from './targets.js'
import { usersSchema } from './users.js'
import {
  formatProvisionError,
  optionalCredentialBytes,
  optionalTrimmedText,
  trimmedText,
} from './zod-utils.js'

// Builtin drivers self-register (overlay schemas + refineProvision).
import '../../vm/drivers/proxmox.js'
import '../../vm/drivers/workstation.js'

/** @import { YamlMapping } from '@qctl/shared' */

/**
 * Host `qctl:` block: shared host-meta fields extended with platform, then enrichment.
 */
export const qctlSchema = qctlHostMetaFieldsSchema
  .extend({
    /** Platform pin (short name or github:…); omitted → rocky. */
    platform: z.string().trim().min(1).default('rocky'),
  })
  .prefault({})
  .transform(enrichQctlHostMetaFields)
  .superRefine(refineQctlHostMeta)

/**
 * Overlay field from the registered driver (runtime), typed via the schema param.
 * @template {z.ZodType} S
 * @param {string} id
 * @param {S} schema  same object the driver registers as provisionOverlaySchema
 * @returns {z.ZodDefault<z.ZodNullable<S>>}
 */
function overlayField(id, schema) {
  const mod = getDriverModule(id)
  if (mod?.provisionOverlaySchema && mod.provisionOverlaySchema !== schema) {
    throw new Error(`provision parse: driver ${id} provisionOverlaySchema !== typed schema export`)
  }
  // Prefer registered module schema when present; typed export covers empty registry
  // (tests that clear drivers after this module was first evaluated).
  const registered = /** @type {S} */ (mod?.provisionOverlaySchema ?? schema)
  return registered.nullable().default(null)
}

/**
 * Extra registered drivers beyond the builtin keys typed on {@link ProvisionBody}.
 * @returns {Record<string, z.ZodTypeAny>}
 */
function extraDriverOverlayFields() {
  /** @type {Record<string, z.ZodTypeAny>} */
  const fields = {}
  for (const id of listDriverIds()) {
    const key = String(id)
    if (key === 'workstation' || key === 'proxmox') continue
    const mod = getDriverModule(id)
    if (!mod?.provisionOverlaySchema) continue
    fields[key] = mod.provisionOverlaySchema.nullable().default(null)
  }
  return fields
}

/** Strict provision document shape (before driver refineProvision). */
const provisionBodySchema = z.strictObject({
  qctl: qctlSchema,
  networking: networkingSchema,
  /** Libvirt target overlay — schema from workstation driver module. */
  workstation: overlayField('workstation', workstationSchema),
  /** Admin SSH pubkeys + optional host-key tarball for seed. */
  ssh: z
    .strictObject({
      authorized_keys: z.union([z.array(trimmedText), trimmedText]).optional(),
      /** gzip tar of /etc/ssh/ssh_host_* (bytes or base64 text); optional. */
      host_keys: optionalCredentialBytes,
    })
    .optional(),
  /** Disk topology (os / data / tanks). Passphrases live under disks.tanks.*.passphrase. */
  disks: disksSchema,
  /** Defaults admin (1000) + apps (900 / subids). */
  users: usersSchema,
  /** podman login lines (host-resolved → Tier-0 ROCKY_REGISTRIES JSON). */
  registries: registriesSchema,
  repo: z
    .strictObject({
      /** Instance VCS for the clone stage. */
      vcs: z.enum(['git', 'hg']).default('git'),
      branch: optionalTrimmedText,
      /** Clone URL (baked as QCTL_REPO_URL). */
      url: optionalTrimmedText,
      /** Guest checkout path (default /tank/rocky). */
      dir: optionalTrimmedText,
      /** Deploy private key (host-resolved → Tier-0 DEPLOY_KEY). */
      deploy_key: optionalCredentialBytes,
    })
    .optional(),
  /** PVE target overlay — schema from proxmox driver module. */
  proxmox: overlayField('proxmox', proxmoxSchema),
  ...extraDriverOverlayFields(),
  /**
   * Extra packages by install source (cloud-init after the platform baseline).
   * Keys are sources: `distro` (dnf/apt), `pipx`, `http` (URL / zip), …
   */
  packages: packagesFieldSchema,
  /**
   * Guest file drops → cloud-init write_files.
   * `repo.vcs: hg` also prepends stock `/etc/mercurial/hgrc` unless that path is listed.
   */
  files: filesSchema,
})

/** @typedef {z.infer<typeof provisionBodySchema>} ProvisionBody */

/** Strict provision document (driver overlay refines applied). */
export const provisionSchema = provisionBodySchema.superRefine((data, ctx) => {
  for (const id of listDriverIds()) {
    getDriverModule(id)?.refineProvision?.(data, ctx)
  }
})

/**
 * Parse provision YAML at a load boundary; Zod failures become labeled Errors.
 * @param {YamlMapping} raw
 * @param {string} source file path or basename label
 * @returns {z.infer<typeof provisionSchema>}
 */
export function parseProvisionOrThrow(raw, source) {
  const r = provisionSchema.safeParse(raw)
  if (!r.success) throw new Error(formatProvisionError(r.error, source))
  return r.data
}
