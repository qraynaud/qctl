/** Shared Proxmox disk config string parsers. */

/**
 * First comma-separated field of a disk config value → volid.
 * @param {string | number | boolean | null | undefined} val
 * @returns {string | null}
 */
export function volidFromDiskValue(val) {
  if (!val) return null
  return String(val).split(',')[0].trim() || null
}

/**
 * @param {string | number | boolean | null | undefined} val
 * @returns {string | null}
 */
export function diskSerialFromValue(val) {
  const m = String(val || '').match(/(?:^|,)serial=([^,]+)/)
  return m ? m[1] : null
}
