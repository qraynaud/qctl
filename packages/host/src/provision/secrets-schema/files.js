import { z } from 'zod'

/** @import { YamlMapping, YamlValue } from '@qctl/shared' */

const pathStr = z.string().trim().min(1)
const modeStr = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const s = String(v).trim()
    // cloud-init expects a string like "0644"
    if (/^\d+$/.test(s) && !s.startsWith('0') && s.length <= 3) return `0${s}`
    return s
  })
  .pipe(z.string().regex(/^[0-7]{3,4}$/, 'mode must be an octal permission like 0644'))

/**
 * Guest file drop (seed → cloud-init write_files).
 * `owner` / `permissions` match cloud-init field names.
 */
export const filesItemSchema = z
  .object({
    path: pathStr,
    owner: z.string().trim().min(1).optional(),
    permissions: modeStr.optional(),
    /** Alias for permissions (either is accepted). */
    mode: modeStr.optional(),
    content: z.string(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (!data.path.startsWith('/')) {
      ctx.addIssue({
        code: 'custom',
        message: 'path must be absolute',
        path: ['path'],
      })
    }
  })

export const filesSchema = z.array(filesItemSchema)

/**
 * @typedef {{ path: string, owner: string, permissions: string, content: string }} GuestFile
 */

/**
 * Normalize `files:` for seed → write_files.
 * @param {YamlValue} [raw]
 * @returns {GuestFile[]}
 */
export function normalizeFiles(raw) {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error('files: must be a list of { path, content, … }')
  }
  /** @type {GuestFile[]} */
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item instanceof Uint8Array) {
      continue
    }
    const rec = /** @type {YamlMapping} */ (item)
    const p = String(rec.path || '').trim()
    if (!p) continue
    const owner = rec.owner != null ? String(rec.owner).trim() : 'root:root'
    const permRaw = rec.permissions ?? rec.mode ?? '0644'
    let permissions = String(permRaw).trim()
    if (/^\d+$/.test(permissions) && !permissions.startsWith('0') && permissions.length <= 3) {
      permissions = `0${permissions}`
    }
    const content = rec.content != null ? String(rec.content) : ''
    out.push({
      path: p,
      owner: owner || 'root:root',
      permissions: permissions || '0644',
      content,
    })
  }
  return out
}

/** Stock system hgrc when `repo.vcs: hg` (evolve + topic). */
export const HG_HGRC_PATH = '/etc/mercurial/hgrc'

export const HG_HGRC_DEFAULT = Object.freeze({
  path: HG_HGRC_PATH,
  owner: 'root:root',
  permissions: '0644',
  content: [
    '# System-wide (all users). Empty values load extensions shipped with hg-evolve.',
    '[extensions]',
    'evolve =',
    'topic =',
    '',
    '[experimental]',
    'evolution = all',
    '',
  ].join('\n'),
})

/**
 * Ensure VCS-related guest files are present (idempotent).
 * Today: `repo.vcs === "hg"` → prepend stock `/etc/mercurial/hgrc` unless that
 * path is already listed (user entry wins).
 *
 * @param {GuestFile[]} files
 * @param {string | undefined | null} vcs
 * @returns {GuestFile[]}
 */
export function applyVcsFileDefaults(files, vcs) {
  const out = [...(files || [])]
  if (vcs === 'hg') {
    const hasHgrc = out.some((f) => f.path === HG_HGRC_PATH)
    if (!hasHgrc) {
      out.unshift({
        path: HG_HGRC_DEFAULT.path,
        owner: HG_HGRC_DEFAULT.owner,
        permissions: HG_HGRC_DEFAULT.permissions,
        content: HG_HGRC_DEFAULT.content,
      })
    }
  }
  return out
}
