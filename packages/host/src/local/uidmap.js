import { MAX_APPS_SUBID_COUNT } from '../provision/schema/users.js'

/** Rootless host relative ids typically available (0 = caller, 1… = /etc/subuid). */
const DEFAULT_HOST_RANGE = 65536

/**
 * Split one id dimension (uid or gid) of the rootless host budget:
 * dense low range for systemd/tooling + provision subordinate block.
 *
 * @param {'uidmap' | 'gidmap'} flag
 * @param {number} appsId
 * @param {{ start: number, count: number }} subRange
 * @param {number} hostRangeSize
 * @returns {string[]}
 */
function splitIdMapArgs(flag, appsId, subRange, hostRangeSize) {
  const count = subRange?.count
  const subStart = subRange?.start
  const label = flag === 'uidmap' ? 'subuid' : 'subgid'
  if (!Number.isInteger(appsId) || appsId < 1) {
    throw new Error(
      `apps ${flag === 'uidmap' ? 'uid' : 'gid'} must be an integer >= 1 (got ${appsId})`,
    )
  }
  if (!Number.isInteger(subStart) || subStart < 0) {
    throw new Error(`apps ${label} start must be a non-negative integer (got ${subStart})`)
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_APPS_SUBID_COUNT) {
    throw new Error(`apps ${label} count must be in 1…${MAX_APPS_SUBID_COUNT} (got ${count})`)
  }
  const internalSize = hostRangeSize - 1 - count
  if (internalSize < 2) {
    throw new Error(
      `host id budget too small for apps ${label} count ${count} (need room for systemd map)`,
    )
  }
  const lowEnd = internalSize - 1
  if (appsId > lowEnd) {
    throw new Error(
      `apps ${flag === 'uidmap' ? 'uid' : 'gid'} ${appsId} must sit in the internal map (0…${lowEnd}); `
        + `reduce users.apps.${label} count or apps id`,
    )
  }
  if (subStart <= lowEnd) {
    throw new Error(
      `users.apps.${label} start ${subStart} overlaps the internal map (0…${lowEnd}); `
        + `use a start above ${lowEnd} (default is <id>×1000)`,
    )
  }

  /** @type {string[]} */
  const args = [`--${flag}=0:1:${appsId}`, `--${flag}=${appsId}:0:1`]
  const afterApps = lowEnd - appsId
  if (afterApps > 0) {
    args.push(`--${flag}=${appsId + 1}:${appsId + 1}:${afterApps}`)
  }
  args.push(`--${flag}=${subStart}:${lowEnd + 1}:${count}`)
  return args
}

/**
 * Split the rootless host id budget for uid and gid independently:
 * - dense low container range for systemd / tooling (apps id → host user)
 * - provision `users.apps.subuid` / `subgid` mapped into the remaining host subs
 *   so in-appliance `/etc/subuid` + `/etc/subgid` match the real env.
 *
 * @param {number} appsUid
 * @param {number} appsGid
 * @param {{ start: number, count: number }} appsSubuid
 * @param {{ start: number, count: number }} appsSubgid
 * @param {number} [hostRangeSize]
 * @returns {string[]}
 */
export function appsUidMapPodmanArgs(
  appsUid,
  appsGid,
  appsSubuid,
  appsSubgid,
  hostRangeSize = DEFAULT_HOST_RANGE,
) {
  return [
    ...splitIdMapArgs('uidmap', appsUid, appsSubuid, hostRangeSize),
    ...splitIdMapArgs('gidmap', appsGid, appsSubgid, hostRangeSize),
  ]
}

/**
 * Outer appliance `--uidmap` / `--gidmap` for `qctl local …`.
 *
 * When `CI` is set (GitLab/GitHub/…), return no maps: rootful nested Podman under a
 * privileged job cannot create dummy VLAN parents if container root is remapped
 * (`RTNETLINK … Operation not permitted`). Local rootless keeps the maps so apps
 * aligns with the host user.
 *
 * @param {number} appsUid
 * @param {number} appsGid
 * @param {{ start: number, count: number }} appsSubuid
 * @param {{ start: number, count: number }} appsSubgid
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function localApplianceUidMapArgs(
  appsUid,
  appsGid,
  appsSubuid,
  appsSubgid,
  env = process.env,
) {
  if (String(env.CI ?? '').trim()) return []
  return appsUidMapPodmanArgs(appsUid, appsGid, appsSubuid, appsSubgid)
}

export { MAX_APPS_SUBID_COUNT as MAX_APPS_SUBUID_COUNT }
