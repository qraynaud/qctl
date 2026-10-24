/**
 * Post-render cloud-config write_files helpers.
 * Seed identity / disks / ports / packages / Tier-0 live on ISO `qctl-seed/`.
 * {@link injectProvisionFiles} is the only injector used by `runSeed`.
 */

/** @import { YamlMapping, YamlValue } from '@qctl/shared' */

/** @typedef {YamlMapping} CloudConfig */
/**
 * @typedef {{
 *   path?: string,
 *   content?: YamlValue,
 *   encoding?: string,
 * } & YamlMapping} CloudWriteFile
 */

/**
 * Merge provision `files:` into cloud-init `write_files` (replaces same path).
 * Ensures content ends with a newline.
 *
 * @param {CloudConfig} userData
 * @param {Array<{
 *   path: string,
 *   owner?: string,
 *   permissions?: string,
 *   content: string,
 * }> | undefined} files
 */
export function injectProvisionFiles(userData, files) {
  if (!userData || typeof userData !== 'object') return userData
  const list = Array.isArray(files) ? files : []
  if (!list.length) return userData

  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  /** @type {Set<string | undefined>} */
  const drop = new Set(list.map((f) => f.path).filter(Boolean))
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && drop.has(w.path)))
  for (const f of list) {
    if (!f?.path) continue
    const body = String(f.content ?? '')
    kept.push({
      path: f.path,
      owner: f.owner || 'root:root',
      permissions: f.permissions || '0644',
      content: body.endsWith('\n') ? body : `${body}\n`,
    })
  }
  userData.write_files = kept
  return userData
}
