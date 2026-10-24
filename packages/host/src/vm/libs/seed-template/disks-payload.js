/**
 * Canonical disks payload for ISO seed config (passphrases stripped).
 */
import { disksJsonSchema } from '@qctl/shared'

/** @import { DisksJson } from '@qctl/shared' */
/** @import { ResolvedDisks } from '../../../provision/schema/resolve-disks.js' */

/**
 * Canonical disks for the guest (passphrases stripped — those are Tier-0 only).
 * Validated via {@link disksJsonSchema}.
 * @param {ResolvedDisks} resolved
 * @returns {DisksJson}
 */
export function disksJsonPayload(resolved) {
  /** @type {DisksJson['tanks']} */
  const tanks = {}
  for (const [key, tank] of Object.entries(resolved.tanks || {})) {
    tanks[key] = {
      id: tank.id,
      mount: tank.mount,
      options: tank.options,
      vdevs: tank.vdevs,
    }
  }
  return disksJsonSchema.parse({
    os: resolved.os,
    data: resolved.data,
    tanks,
    members: resolved.members,
    encryptedTankIds: [...(resolved.encryptedTankIds || [])],
  })
}
