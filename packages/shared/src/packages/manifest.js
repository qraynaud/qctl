/**
 * Canonical package manifest shape (provision `packages:` + platform capability recipes).
 */
import { z } from 'zod'

/** Package / path token: non-empty, no whitespace (incl. padded laziness). */
const pkgName = z.string().regex(/^\S+$/, 'must be non-empty with no whitespace')

/** Long pipx form (always the parse output shape). */
const packagesPipxObjectSchema = z.strictObject({
  package: pkgName,
  inject: pkgName.array().default([]),
})

/**
 * `packages.pipx` entry: bare package spec → `{ package, inject: [] }`, or the object form.
 */
export const packagesPipxItemSchema = pkgName
  .transform((name) => ({ package: name, inject: /** @type {string[]} */ ([]) }))
  .or(packagesPipxObjectSchema)

/**
 * `packages.http` entry: download URL → binary.
 */
export const packagesHttpItemSchema = z
  .strictObject({
    url: z.url(),
    bin: pkgName.optional(),
    dest: z.string().min(1).optional(),
    test: z.string().min(1).optional(),
  })
  .refine((data) => data.bin != null || data.dest != null, {
    message: 'need bin (zip member / /usr/local/bin name) or dest (absolute path)',
    path: ['bin'],
  })

/**
 * @typedef {object} NormalizedHttpItem
 * @property {string} url
 * @property {string} [bin]
 * @property {string} [dest]
 * @property {string} [test]
 */

/**
 * @typedef {object} NormalizedPackages
 * @property {string[]} distro
 * @property {{ package: string, inject: string[] }[]} pipx
 * @property {NormalizedHttpItem[]} http
 */

/**
 * Provision / capability packages → normalized on parse
 * (`undefined` / `{}` → empty lists; pipx strings → objects).
 */
export const packagesManifestSchema = z
  .strictObject({
    distro: pkgName.array().default([]),
    pipx: packagesPipxItemSchema.array().default([]),
    http: packagesHttpItemSchema.array().default([]),
  })
  .prefault({})

/**
 * Merge manifests (later lists append; pipx/http: later entry wins on same package/bin name).
 * @param {...NormalizedPackages | undefined} parts
 * @returns {NormalizedPackages}
 */
export function mergePackages(...parts) {
  /** @type {string[]} */
  const distro = []
  /** @type {Map<string, { package: string, inject: string[] }>} */
  const pipxByName = new Map()
  /** @type {Map<string, NormalizedHttpItem>} */
  const httpByKey = new Map()

  for (const part of parts) {
    if (!part) continue
    for (const d of part.distro || []) {
      if (!distro.includes(d)) distro.push(d)
    }
    for (const p of part.pipx || []) {
      const name = String(p.package || '')
        .split(/[<=>!~]/)[0]
        ?.trim()
      if (!name) continue
      pipxByName.set(name, { package: p.package, inject: [...(p.inject || [])] })
    }
    for (const h of part.http || []) {
      const key = h.bin || h.dest || h.url
      if (!key) continue
      httpByKey.set(key, { ...h })
    }
  }
  return {
    distro,
    pipx: [...pipxByName.values()],
    http: [...httpByKey.values()],
  }
}

/**
 * @param {NormalizedPackages} packages
 * @returns {boolean}
 */
export function packagesIsEmpty(packages) {
  return (
    (packages.distro?.length ?? 0) === 0
    && (packages.pipx?.length ?? 0) === 0
    && (packages.http?.length ?? 0) === 0
  )
}
