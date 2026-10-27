/**
 * Local ISO binds: provision disk map keys → host `volumes/<kind>/<key>` dirs.
 */

export const LOCAL_DISK_KIND = Object.freeze({
  TANK: 'tank',
  DATA: 'data',
})

/** @typedef {typeof LOCAL_DISK_KIND[keyof typeof LOCAL_DISK_KIND]} LocalDiskKind */

/**
 * @typedef {object} LocalDiskMount
 * @property {LocalDiskKind} kind
 * @property {string} key provision map key (`disks.tanks.<key>` / `disks.data.<key>`)
 * @property {string} hostRel path under instance root (`volumes/tank/<key>` / `volumes/data/<key>`)
 * @property {string} mount guest absolute mount path
 */

/**
 * @typedef {object} DisksMountSource
 * @property {Record<string, { mount?: string }> } [data]
 * @property {Record<string, { mount?: string }> } [tanks]
 */

/**
 * Normalize guest mount for compare/bind (trim; drop trailing `/` except root).
 * @param {string} mount
 * @returns {string}
 */
export function normalizeGuestMount(mount) {
  const m = String(mount).trim()
  if (m === '/') return '/'
  return m.replace(/\/+$/, '') || '/'
}

/**
 * Path depth for bind order (`/tank` before `/tank/rocky`).
 * @param {string} mount normalized absolute path
 * @returns {number}
 */
export function guestMountDepth(mount) {
  if (mount === '/') return 0
  return mount.split('/').filter(Boolean).length
}

/**
 * Host-relative dir for a provision disk entry.
 * @param {LocalDiskKind} kind
 * @param {string} key
 * @returns {string}
 */
export function localDiskHostRel(kind, key) {
  return `volumes/${kind}/${key}`
}

/**
 * Map `disks.tanks` / `disks.data` to local bind specs, parents before children.
 * @param {DisksMountSource | null | undefined} disks
 * @returns {LocalDiskMount[]}
 */
export function localDiskMounts(disks) {
  /** @type {LocalDiskMount[]} */
  const out = []
  if (!disks) return out

  for (const [key, vol] of Object.entries(disks.data || {})) {
    const mount = vol?.mount
    if (mount == null || String(mount).trim() === '') continue
    out.push({
      kind: LOCAL_DISK_KIND.DATA,
      key,
      hostRel: localDiskHostRel(LOCAL_DISK_KIND.DATA, key),
      mount: normalizeGuestMount(mount),
    })
  }

  for (const [key, tank] of Object.entries(disks.tanks || {})) {
    const mount = tank?.mount
    if (mount == null || String(mount).trim() === '') continue
    out.push({
      kind: LOCAL_DISK_KIND.TANK,
      key,
      hostRel: localDiskHostRel(LOCAL_DISK_KIND.TANK, key),
      mount: normalizeGuestMount(mount),
    })
  }

  out.sort((a, b) => {
    const d = guestMountDepth(a.mount) - guestMountDepth(b.mount)
    if (d !== 0) return d
    return a.mount < b.mount ? -1 : a.mount > b.mount ? 1 : a.key.localeCompare(b.key)
  })
  return out
}
