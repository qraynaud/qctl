import { z } from 'zod'

const pathStr = z
  .string()
  .trim()
  .min(1)
  .refine((p) => p.startsWith('/'), 'path must be absolute')

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
 * Output always has owner + permissions (mode alias accepted on input).
 */
export const filesItemSchema = z
  .strictObject({
    path: pathStr,
    owner: z.string().trim().min(1).optional(),
    permissions: modeStr.optional(),
    /** Alias for permissions (either is accepted). */
    mode: modeStr.optional(),
    content: z.string().default(''),
  })
  .transform((item) => ({
    path: item.path,
    owner: item.owner || 'root:root',
    permissions: item.permissions ?? item.mode ?? '0644',
    content: item.content,
  }))

export const filesSchema = z.array(filesItemSchema).prefault([])

/**
 * @typedef {{ path: string, owner: string, permissions: string, content: string }} GuestFile
 */

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
