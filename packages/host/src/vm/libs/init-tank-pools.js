/**
 * Resolve which tank pools `vm init-tank [poolId…]` should create.
 */
import { die } from '../../lib/util.js'

/** @import { ResolvedDiskMember, ResolvedDisks } from '../../provision/schema/resolve-disks.js' */

/**
 * @typedef {object} InitTankSelection
 * @property {string[]} poolIds resolved pool ids (order: provision / CLI)
 * @property {string[]} memberIds tank member disk ids for those pools
 * @property {ResolvedDiskMember[]} members tank members only
 */

/**
 * @param {ResolvedDisks} resolved
 * @returns {string[]}
 */
export function allTankPoolIds(resolved) {
  return Object.values(resolved.tanks || {}).map((t) => t.id)
}

/**
 * Tank members owned by the given pool ids.
 * @param {ResolvedDisks} resolved
 * @param {string[]} poolIds
 * @returns {ResolvedDiskMember[]}
 */
export function tankMembersForPools(resolved, poolIds) {
  const want = new Set(poolIds)
  return resolved.members.filter((m) => m.kind === 'tank' && m.owner && want.has(m.owner))
}

/**
 * @param {string | number | string[] | undefined | null} raw
 * @returns {string[]}
 */
function normalizePoolIdArgs(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw
      .flatMap((x) => String(x).split(','))
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Bare = all tanks; CLI ids must match resolved pool ids.
 * @param {ResolvedDisks} resolved
 * @param {string | number | string[] | undefined | null} poolIdArgs yargs positional(s)
 * @returns {InitTankSelection | null} null when provision has no tanks
 */
export function resolveInitTankPools(resolved, poolIdArgs) {
  const available = allTankPoolIds(resolved)
  if (available.length === 0) return null

  const requested = normalizePoolIdArgs(poolIdArgs)
  /** @type {string[]} */
  let poolIds
  if (requested.length === 0) {
    poolIds = available
  } else {
    const known = new Set(available)
    const unknown = requested.filter((id) => !known.has(id))
    if (unknown.length) {
      die(
        `init-tank: unknown pool id(s): ${unknown.join(', ')} `
          + `(provision tanks: ${available.join(', ')})`,
      )
    }
    // Preserve CLI order; drop dupes.
    const seen = new Set()
    poolIds = []
    for (const id of requested) {
      if (seen.has(id)) continue
      seen.add(id)
      poolIds.push(id)
    }
  }

  const members = tankMembersForPools(resolved, poolIds)
  return {
    poolIds,
    memberIds: members.map((m) => m.id),
    members,
  }
}
