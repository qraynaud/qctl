import { z } from 'zod'

import { disksSchema } from './disks.js'
import { filesSchema } from './files.js'
import { registriesSchema } from './first-boot.js'
import { alignProxmoxNets, networkingSchema } from './networking.js'
import { packagesFieldSchema } from './packages.js'
import { localSchema, proxmoxSchema } from './targets.js'
import { usersSchema } from './users.js'
import {
  formatProvisionError,
  optionalCredentialBytes,
  optionalTrimmedText,
  trimmedText,
} from './zod-utils.js'

/** Strict provision document shape (before cross-field refines). */
const provisionBodySchema = z.strictObject({
  /** Platform pin (short name or github:…); omitted → rocky. */
  qctl: z
    .strictObject({
      platform: z.string().trim().min(1).default('rocky'),
    })
    .prefault({}),
  networking: networkingSchema,
  local: localSchema.nullable().default(null),
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
      /** Clone URL (baked as ROCKY_HG_URL / ROCKY_REPO_URL). */
      url: optionalTrimmedText,
      /** Guest checkout path (default /tank/rocky). */
      dir: optionalTrimmedText,
      /** Deploy private key (host-resolved → Tier-0 DEPLOY_KEY). */
      deploy_key: optionalCredentialBytes,
    })
    .optional(),
  proxmox: proxmoxSchema.nullable().default(null),
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

/** @param {ProvisionBody} data */
function proxmoxNetNamesMatchUplinks(data) {
  if (!data.proxmox?.net) return true
  const uplinkNames = new Set(Object.keys(data.networking.uplinks))
  return Object.keys(data.proxmox.net).every((name) => uplinkNames.has(name))
}

/** @param {ProvisionBody} data */
function everyUplinkHasProxmoxNet(data) {
  if (!data.proxmox?.net) return true
  const netNames = new Set(Object.keys(data.proxmox.net))
  return Object.keys(data.networking.uplinks).every((name) => netNames.has(name))
}

/** @param {ProvisionBody} data */
function vlansCarriedOnProxmoxNets(data) {
  if (!data.proxmox) return true
  const nets = alignProxmoxNets(data.networking.uplinks, data.proxmox.net)
  const byUplink = new Map(nets.map((n) => [n.name, n]))
  return Object.values(data.networking.vlans).every((v) => {
    if (!v.link) return true
    const net = byUplink.get(v.link)
    if (!net) return true
    return (net.vlan && net.vlan === v.id) || (net.trunks?.includes(v.id) ?? false)
  })
}

/** Strict provision document. */
export const provisionSchema = provisionBodySchema
  .refine(proxmoxNetNamesMatchUplinks, {
    message: 'each proxmox.net key must match an networking.uplinks key',
    path: ['proxmox', 'net'],
  })
  .refine(everyUplinkHasProxmoxNet, {
    message: 'each networking.uplinks entry needs a matching proxmox.net.<name>',
    path: ['proxmox', 'net'],
  })
  .refine(vlansCarriedOnProxmoxNets, {
    message: 'each networking.vlans id must be carried on proxmox.net.<link> (tag or trunks)',
    path: ['proxmox', 'net'],
  })

/**
 * Parse provision YAML at a load boundary; Zod failures become labeled Errors.
 * @param {unknown} raw
 * @param {string} source file path or basename label
 * @returns {z.infer<typeof provisionSchema>}
 */
export function parseProvisionOrThrow(raw, source) {
  const r = provisionSchema.safeParse(raw)
  if (!r.success) throw new Error(formatProvisionError(r.error, source))
  return r.data
}
