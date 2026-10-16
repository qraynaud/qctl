/**
 * Canonical package manifest shape (provision `packages:` + platform capability recipes).
 */
import { z } from 'zod'

const pkgName = z.string().trim().min(1)

/** `packages.pipx` entry: bare package spec or `{ package, inject? }`. */
export const packagesPipxItemSchema = z.union([
  pkgName,
  z.strictObject({
    package: pkgName,
    inject: z.array(pkgName).optional(),
  }),
])

/**
 * `packages.http` entry: download URL → binary.
 */
export const packagesHttpItemSchema = z
  .strictObject({
    url: z.string().trim().url(),
    bin: pkgName.optional(),
    dest: z.string().trim().min(1).optional(),
    test: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.bin != null || data.dest != null, {
    message: 'need bin (zip member / /usr/local/bin name) or dest (absolute path)',
    path: ['bin'],
  })

/**
 * @typedef {object} NormalizedPackages
 * @property {string[]} distro
 * @property {{ package: string, inject: string[] }[]} pipx
 * @property {{ url: string, bin: string | null, dest: string | null, test: string | null }[]} http
 */

export const packagesManifestSchema = z.strictObject({
  distro: z.array(pkgName).optional(),
  pipx: z.array(packagesPipxItemSchema).optional(),
  http: z.array(packagesHttpItemSchema).optional(),
})

/** Empty normalized manifest. */
export function emptyPackages() {
  return { distro: /** @type {string[]} */ ([]), pipx: [], http: [] }
}

/**
 * @param {z.infer<typeof packagesManifestSchema> | null | undefined} raw
 * @returns {NormalizedPackages}
 */
export function normalizePackages(raw) {
  const distro = (raw?.distro || []).map((s) => String(s).trim()).filter(Boolean)
  /** @type {{ package: string, inject: string[] }[]} */
  const pipx = []
  for (const item of raw?.pipx || []) {
    if (typeof item === 'string') {
      const p = item.trim()
      if (p) pipx.push({ package: p, inject: [] })
      continue
    }
    const p = String(item?.package || '').trim()
    if (!p) continue
    const inject = (item.inject || []).map((s) => String(s).trim()).filter(Boolean)
    pipx.push({ package: p, inject })
  }
  /** @type {{ url: string, bin: string | null, dest: string | null, test: string | null }[]} */
  const http = []
  for (const item of raw?.http || []) {
    const url = String(item?.url || '').trim()
    if (!url) continue
    const bin = item.bin != null ? String(item.bin).trim() : ''
    const dest = item.dest != null ? String(item.dest).trim() : ''
    const test = item.test != null ? String(item.test).trim() : ''
    http.push({
      url,
      bin: bin || null,
      dest: dest || null,
      test: test || null,
    })
  }
  return { distro, pipx, http }
}

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
  /**
   * @type {Map<
   *   string,
   *   { url: string, bin: string | null, dest: string | null, test: string | null }
   * >}
   */
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
