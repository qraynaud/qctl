/**
 * Disk attach mode: `size` → allocate/create a virtual disk; omit `size` →
 * bind an existing physical disk (by-id / holder serial).
 */
import { existsSync } from 'node:fs'

import { die } from '../../lib/util.js'

/** @import { ResolvedDiskMember } from '../../provision/schema/resolve-disks.js' */

/**
 * @typedef {'virtual' | 'physical'} AttachMode
 */

/**
 * @typedef {ResolvedDiskMember & { mode: AttachMode }} DiskWithAttachMode
 */

/**
 * @param {ResolvedDiskMember} member
 * @returns {DiskWithAttachMode}
 */
export function withAttachMode(member) {
  return member.size ? { ...member, mode: 'virtual' } : { ...member, mode: 'physical' }
}

/**
 * @param {ResolvedDiskMember[]} members
 * @returns {DiskWithAttachMode[]}
 */
export function withAttachModes(members) {
  return members.map(withAttachMode)
}

/**
 * Linux by-id path for a disk serial / wwn-style id.
 * @param {string} id
 * @returns {string}
 */
export function byIdPath(id) {
  return `/dev/disk/by-id/${id}`
}

/**
 * Local: refuse virtual create when a by-id device already exists.
 * Physical members must already exist as by-id **or** as an on-disk qcow.
 *
 * @param {DiskWithAttachMode[]} members
 * @param {{
 *   qcowPath: (id: string) => string,
 *   byIdExists?: (id: string) => boolean,
 *   qcowExists?: (path: string) => boolean,
 * }} opts
 */
export function assertLocalAttachModes(members, opts) {
  const byIdExists = opts.byIdExists || ((id) => existsSync(byIdPath(id)))
  const qcowExists = opts.qcowExists || ((p) => existsSync(p))

  for (const m of members) {
    if (m.mode === 'virtual') {
      if (byIdExists(m.id)) {
        die(
          `disks: ${m.id} has size=${m.size} (virtual) but physical ${byIdPath(m.id)} exists — `
            + `remove size to use the physical disk, or remove the by-id device`,
        )
      }
      continue
    }
    const qcow = opts.qcowPath(m.id)
    if (!byIdExists(m.id) && !qcowExists(qcow)) {
      die(`disks: ${m.id} has no size (physical) but neither ${byIdPath(m.id)} nor ${qcow} exists`)
    }
  }
}

/**
 * Proxmox: physical members must already appear (serial → volid) on the VM/holder.
 * Virtual members may be missing (create) or reused when present.
 *
 * @param {DiskWithAttachMode[]} members non-OS members (caller filters)
 * @param {Record<string, string | null | undefined>} volidBySerial
 */
export function assertProxmoxAttachModes(members, volidBySerial) {
  for (const m of members) {
    if (m.mode !== 'physical') continue
    if (!volidBySerial[m.id]) {
      die(
        `disks: ${m.id} has no size (physical) but no Proxmox disk with serial=${m.id} `
          + `(attach passthrough / by-id on the VM or holder, or set size for a virtual disk)`,
      )
    }
  }
}

/**
 * One-line layout summary for logs.
 * @param {DiskWithAttachMode[]} members
 * @returns {string}
 */
export function summarizeAttachModes(members) {
  const parts = members.map((m) => {
    const tag = m.mode === 'virtual' ? m.size : 'physical'
    return `${m.id}(${tag})`
  })
  return parts.join(', ')
}

/**
 * Non-OS member ids (data volumes + tank vdev members).
 * @param {ResolvedDiskMember[]} members
 * @returns {string[]}
 */
export function persistentDiskIds(members) {
  return members.filter((m) => m.kind !== 'os').map((m) => m.id)
}

/**
 * @param {ResolvedDiskMember[]} members
 * @param {'os' | 'data' | 'tank'} kind
 * @returns {string[]}
 */
export function diskIdsByKind(members, kind) {
  return members.filter((m) => m.kind === kind).map((m) => m.id)
}

/**
 * Proxmox attach specs for non-OS members (caller may fill `volid`).
 * @param {ResolvedDiskMember[]} members
 * @returns {Array<{
 *   id: string,
 *   mode: AttachMode,
 *   kind: 'data' | 'tank',
 *   size?: string,
 * }>}
 */
export function attachSpecsFromMembers(members) {
  return withAttachModes(members)
    .filter((m) => m.kind !== 'os')
    .map((m) => ({
      id: m.id,
      mode: m.mode,
      kind: m.kind === 'data' ? /** @type {const} */ ('data') : /** @type {const} */ ('tank'),
      ...(m.size ? { size: m.size } : {}),
    }))
}
