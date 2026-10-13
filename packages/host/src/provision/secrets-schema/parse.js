import { z } from 'zod'

import { filesSchema, normalizeFiles } from './files.js'
import { registriesSchema, tankSchema } from './first-boot.js'
import { alignProxmoxNets, networkingSchema, portsSchema } from './networking.js'
import { normalizePackages, packagesSchema } from './packages.js'
import { localSchema, proxmoxSchema } from './targets.js'
import { usersSchema } from './users.js'
import {
  formatSecretsError,
  optionalCredentialBytes,
  optionalTrimmedText,
  parseSecretsSchema,
  trimmedText,
} from './zod-utils.js'

export const secretsFileSchema = z
  .object({
    networking: networkingSchema,
    local: localSchema.optional().nullable(),
    /** Admin SSH pubkeys + optional host-key tarball for seed. */
    ssh: z
      .object({
        authorized_keys: z.union([z.array(trimmedText), trimmedText]).optional(),
        /** gzip tar of /etc/ssh/ssh_host_* (bytes or base64 text); optional. */
        host_keys: optionalCredentialBytes.optional(),
      })
      .passthrough()
      .optional(),
    /** ZFS tank key (host-resolved → Tier-0 TANK_PASSPHRASE). */
    tank: tankSchema,
    /** Optional; defaults admin (1000) + apps (900 / subids). */
    users: z.preprocess((v) => (v == null ? {} : v), usersSchema),
    /** podman login lines (host-resolved → Tier-0 ROCKY_REGISTRIES JSON). */
    registries: registriesSchema,
    repo: z
      .object({
        /** Instance VCS for the clone stage. Default `git` when omitted. */
        vcs: z.enum(['git', 'hg']).optional(),
        branch: optionalTrimmedText.optional(),
        /** Clone URL (baked as ROCKY_HG_URL / ROCKY_REPO_URL). */
        url: optionalTrimmedText.optional(),
        /** Guest checkout path (default /tank/rocky). */
        dir: optionalTrimmedText.optional(),
        /** Deploy private key (host-resolved → Tier-0 DEPLOY_KEY). */
        deploy_key: optionalCredentialBytes.optional(),
      })
      .passthrough()
      .optional(),
    proxmox: proxmoxSchema.optional().nullable(),
    /**
     * Extra packages by install source (cloud-init after the platform baseline).
     * Keys are sources: `distro` (dnf/apt), `pipx`, `http` (URL / zip), …
     */
    packages: packagesSchema.optional(),
    /**
     * Guest file drops → cloud-init write_files.
     * `repo.vcs: hg` also prepends stock `/etc/mercurial/hgrc` unless that path is listed.
     */
    files: filesSchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (data.proxmox == null) return

    const { uplinks, vlans } = data.networking
    const uplinkNames = uplinks.map((u) => u.name)
    const netRaw = data.proxmox.net

    if (netRaw != null) {
      const netNames = /** @type {string[]} */ (netRaw.map((n) => n.name).filter(Boolean))
      for (const name of netNames) {
        if (!uplinkNames.includes(name)) {
          ctx.addIssue({
            code: 'custom',
            message: `key ${JSON.stringify(name)} must match an networking.uplinks key`,
            path: ['proxmox', 'net', name],
          })
        }
      }
      for (const name of uplinkNames) {
        if (!netNames.includes(name)) {
          ctx.addIssue({
            code: 'custom',
            message: `missing NIC for uplink ${JSON.stringify(name)} (add proxmox.net.${name})`,
            path: ['proxmox', 'net', name],
          })
        }
      }
    }

    const nets = alignProxmoxNets(uplinks, netRaw)
    const byUplink = new Map(nets.map((n) => [n.name, n]))

    for (const v of vlans) {
      const net = byUplink.get(v.link)
      if (!net) continue
      const carried = (net.vlan != null && net.vlan === v.id) || net.trunks?.includes(v.id)
      if (!carried) {
        ctx.addIssue({
          code: 'custom',
          message: `id=${v.id} on uplink ${v.link} is not in proxmox.net.${v.link} tag/trunks`,
          path: ['networking', 'vlans', v.name, 'id'],
        })
        ctx.addIssue({
          code: 'custom',
          message: `must carry networking.vlans.${v.name} id=${v.id} (tag or trunks)`,
          path: ['proxmox', 'net', v.link],
        })
      }
    }
  })

/**
 * Loose peek at unparsed root for legacy-path errors before Zod.
 *
 * @typedef {object} SecretsRootPreview
 * @property {unknown} [ports]
 * @property {unknown} [admin]
 * @property {{ ports?: unknown }} [networking]
 * @property {unknown} [packages]
 */

/**
 * @param {unknown} raw untyped document (YAML load / `!env` resolve)
 * @param {string} [source] path for error prefix
 */
export function parseSecretsFile(raw, source = 'secrets') {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source}: must be a mapping`)
  }
  const root = /** @type {Record<string, unknown> & SecretsRootPreview} */ (raw)
  // Before nested parse: top-level ports alone never reaches superRefine (networking required).
  if (root.ports != null && root.networking?.ports == null) {
    throw new Error(
      formatSecretsError(
        new z.ZodError([
          {
            code: 'custom',
            message:
              'move top-level ports: under networking: (see provision/dev.yaml from `qctl init`)',
            path: ['ports'],
          },
        ]),
        source,
      ),
    )
  }
  if (root.admin != null) {
    throw new Error(
      formatSecretsError(
        new z.ZodError([
          {
            code: 'custom',
            message:
              'move top-level admin: under users.admin (see provision/dev.yaml from `qctl init`)',
            path: ['admin'],
          },
        ]),
        source,
      ),
    )
  }
  if (Array.isArray(root.packages)) {
    throw new Error(
      `${source}:\npackages: must be a mapping of sources (distro / pipx / http), not a list.\n`
        + `  Example:\n`
        + `    packages:\n`
        + `      distro: [nano]\n`
        + `      http:\n`
        + `        - url: https://…/bw-linux-….zip\n`
        + `          bin: bw\n`
        + `          test: '[[ "$($APP --version)" == "2025.11.0" ]]'`,
    )
  }
  const data = parseSecretsSchema(secretsFileSchema, raw, source)
  const nets = alignProxmoxNets(data.networking.uplinks, data.proxmox?.net)
  // Normalize only — VCS defaults (mercurial / hgrc) are applied at seed for the
  // appliance profile (`vm up`), not for init-tank (no instance clone).
  const packages = normalizePackages(data.packages)
  const files = normalizeFiles(data.files)
  data.packages = /** @type {typeof data.packages} */ ({
    ...(typeof data.packages === 'object' && data.packages && !Array.isArray(data.packages)
      ? data.packages
      : {}),
    distro: packages.distro,
    pipx: packages.pipx,
    http: packages.http,
  })
  data.files = files

  return {
    data,
    ports: data.networking.ports,
    uplinks: data.networking.uplinks,
    vlans: data.networking.vlans,
    nets,
    local: data.local ?? null,
    proxmox: data.proxmox ?? null,
    packages,
    files,
  }
}

/**
 * @param {unknown} raw
 * @param {string} [source]
 * @returns {z.infer<typeof portsSchema>}
 */
export function parsePorts(raw, source = 'secrets') {
  return parseSecretsSchema(portsSchema, raw, source, ['networking', 'ports'])
}
