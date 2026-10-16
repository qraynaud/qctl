/**
 * Post-render cloud-config write_files injectors (Tier-0, packages, provision files).
 */
import { disksJsonSchema, isEmptyCredential, portsSchema } from '@qctl/shared'

import { isCloudInitYamlSafe, withTrailingNewline } from './util.js'

/** @import { DisksJson, YamlMapping, YamlValue } from '@qctl/shared' */
/** @import { NormalizedPackages } from '../../../provision/schema/packages.js' */
/** @import { ResolvedDisks } from '../../../provision/schema/resolve-disks.js' */

/** @typedef {YamlMapping} CloudConfig */
/**
 * @typedef {{
 *   path?: string,
 *   content?: YamlValue,
 *   encoding?: string,
 * } & YamlMapping} CloudWriteFile
 */

const TIER0_PENDING_PREFIX = '/var/lib/rocky/tier0-pending/'

/**
 * @param {string | Buffer} value
 * @returns {Buffer}
 */
function toCredentialBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  return Buffer.from(String(value ?? ''), 'utf8')
}

/**
 * Encode a Tier-0 credential for cloud-init write_files.
 *
 * - Valid utf8 + YAML-safe → plain text (+ trailing newline).
 * - Valid utf8 but YAML-unsafe → `encoding: base64` (raw utf8 bytes on disk).
 * - Non-utf8 bytes → base64 *text* content (no encoding key) so
 *   `$CREDENTIALS_DIRECTORY` utf8 hydrate + guest `decodeBootstrapBytes` work.
 *
 * @param {string | Buffer} value
 * @returns {Pick<CloudWriteFile, 'content' | 'encoding'>}
 */
function cloudInitFileContent(value) {
  const buf = toCredentialBuffer(value)
  const asUtf8 = buf.toString('utf8')
  const validUtf8 = Buffer.from(asUtf8, 'utf8').equals(buf)

  if (validUtf8 && isCloudInitYamlSafe(asUtf8)) {
    return { content: withTrailingNewline(asUtf8) ?? `${asUtf8}\n` }
  }
  if (validUtf8) {
    return {
      encoding: 'base64',
      content: buf.toString('base64'),
    }
  }
  const b64 = buf.toString('base64')
  return { content: withTrailingNewline(b64) ?? `${b64}\n` }
}

/**
 * Embed every `@tag(guest)` value as a Tier-0 pending write_files entry
 * (`/var/lib/rocky/tier0-pending/<KEY>`). Replaces any prior entry for the same path.
 *
 * @param {CloudConfig} userData parsed cloud-config
 * @param {Record<string, string | Buffer> | undefined} guest
 */
export function injectGuestCredentialFiles(userData, guest) {
  if (!userData || typeof userData !== 'object') return userData
  const entries = Object.entries(guest || {}).filter(([, v]) => !isEmptyCredential(v))
  if (!entries.length) return userData

  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  /** @type {Set<string | undefined>} */
  const drop = new Set(entries.map(([key]) => `${TIER0_PENDING_PREFIX}${key}`))
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && drop.has(w.path)))
  for (const [key, value] of entries) {
    kept.push({
      path: `${TIER0_PENDING_PREFIX}${key}`,
      owner: 'root:root',
      permissions: '0400',
      ...cloudInitFileContent(value),
    })
  }
  userData.write_files = kept
  return userData
}

const PACKAGES_JSON_PATH = '/usr/local/lib/rocky/packages.json'
export const DISKS_JSON_PATH = '/usr/local/lib/rocky/disks.json'
export const PORTS_JSON_PATH = '/usr/local/lib/rocky/ports.json'

/**
 * Canonical disks for the guest (passphrases stripped — those are Tier-0 only).
 * Validated via {@link disksJsonSchema}.
 * @param {ResolvedDisks} resolved
 * @returns {DisksJson}
 */
export function disksJsonPayload(resolved) {
  /** @type {DisksJson['tanks']} */
  const tanks = {}
  for (const [key, tank] of Object.entries(resolved.tanks || {})) {
    tanks[key] = {
      id: tank.id,
      mount: tank.mount,
      options: tank.options,
      vdevs: tank.vdevs,
    }
  }
  return disksJsonSchema.parse({
    os: resolved.os,
    data: resolved.data,
    tanks,
    members: resolved.members,
    encryptedTankIds: [...(resolved.encryptedTankIds || [])],
  })
}

/**
 * Embed resolved disk topology for guest stages (`disks.json`).
 * @param {CloudConfig} userData
 * @param {ResolvedDisks | null | undefined} resolved
 */
export function injectResolvedDisks(userData, resolved) {
  if (!userData || typeof userData !== 'object' || !resolved) return userData
  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && w.path === DISKS_JSON_PATH))
  kept.push({
    path: DISKS_JSON_PATH,
    owner: 'root:root',
    permissions: '0644',
    content: `${JSON.stringify(disksJsonPayload(resolved), null, 2)}\n`,
  })
  userData.write_files = kept
  return userData
}

/**
 * Embed provision ports map for guest DNAT (`ports.json`).
 * Guest platform applies firewalld forwards from entries with `dnat`.
 *
 * @param {CloudConfig} userData
 * @param {unknown} ports raw provision ports map (validated by portsSchema)
 */
export function injectPorts(userData, ports) {
  if (!userData || typeof userData !== 'object') return userData
  const body = portsSchema.parse(ports ?? {})
  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  const kept = writeFiles.filter((w) => !(w && typeof w === 'object' && w.path === PORTS_JSON_PATH))
  kept.push({
    path: PORTS_JSON_PATH,
    owner: 'root:root',
    permissions: '0644',
    content: `${JSON.stringify(body, null, 2)}\n`,
  })
  userData.write_files = kept
  return userData
}

/**
 * Embed normalized `packages` (distro / pipx / http) for guest init
 * (`/usr/local/lib/rocky/packages.json`).
 *
 * @param {CloudConfig} userData
 * @param {NormalizedPackages | undefined} packages
 */
export function injectPackagesManifest(userData, packages) {
  if (!userData || typeof userData !== 'object') return userData
  const body = {
    distro: packages?.distro || [],
    pipx: packages?.pipx || [],
    http: packages?.http || [],
  }
  /** @type {CloudWriteFile[]} */
  const writeFiles = Array.isArray(userData.write_files)
    ? /** @type {CloudWriteFile[]} */ ([...userData.write_files])
    : []
  const kept = writeFiles.filter(
    (w) => !(w && typeof w === 'object' && w.path === PACKAGES_JSON_PATH),
  )
  kept.push({
    path: PACKAGES_JSON_PATH,
    owner: 'root:root',
    permissions: '0644',
    content: `${JSON.stringify(body, null, 2)}\n`,
  })
  userData.write_files = kept
  return userData
}

/**
 * Merge provision `files:` into cloud-init `write_files` (replaces same path).
 * Ensures content ends with a newline.
 *
 * @param {CloudConfig} userData
 * @param {{ path: string, owner?: string, permissions?: string, content: string }[] | undefined} files
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
