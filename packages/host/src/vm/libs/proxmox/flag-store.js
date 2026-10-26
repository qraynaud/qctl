/**
 * Proxmox {@link VmFlagStore}: flags as scoped QEMU tag tokens `qctl.<name>=<wire>`.
 */
import { INSTALLED, VmFlagNotFoundError, jsonCodec } from '../flags.js'
import { pveUnknown } from './api-schemas.js'

/** @import { VmFlagDef, VmFlagStore } from '../flag-store.js' */
/** @import { ProxmoxClient } from './client.js' */
/** @import { QemuConfig } from './types.js' */

const SCOPE = 'qctl.'

/**
 * @param {string} name
 * @returns {string}
 */
function flagKey(name) {
  return `${SCOPE}${name}`
}

/**
 * @param {string} name
 * @returns {RegExp}
 */
function flagTokenRe(name) {
  const key = flagKey(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${key}=(.*)$`)
}

/**
 * Split a PVE `tags` string into trimmed non-empty entries (order preserved, deduped).
 * @param {string | number | boolean | null | undefined} tags
 * @returns {string[]}
 */
export function parseProxmoxTags(tags) {
  if (tags == null || tags === false) return []
  const raw = String(tags)
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const part of raw.split(/[;,]/)) {
    const t = part.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * @param {Iterable<string>} tags
 * @returns {string}
 */
export function formatProxmoxTags(tags) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const t of tags) {
    const s = String(t).trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out.join(';')
}

/**
 * @param {string[]} tags
 * @param {string} name
 * @returns {string | undefined} wire payload after `=`, or undefined if absent
 */
export function readFlagWireFromTags(tags, name) {
  const re = flagTokenRe(name)
  for (const t of tags) {
    const m = re.exec(t)
    if (m) return m[1]
  }
  return undefined
}

/**
 * Replace or remove a scoped flag token; preserves unrelated tags (incl. other qctl.*).
 * @param {string | number | boolean | null | undefined} tags
 * @param {string} name
 * @param {string | undefined} wire `undefined` deletes the flag
 * @returns {string}
 */
export function withFlagWire(tags, name, wire) {
  const key = flagKey(name)
  const re = flagTokenRe(name)
  const list = parseProxmoxTags(tags).filter((t) => !re.test(t))
  if (wire !== undefined) list.push(`${key}=${wire}`)
  return formatProxmoxTags(list)
}

/**
 * True when the installed flag decodes to `true`.
 * @param {string | number | boolean | null | undefined} tags
 * @returns {boolean}
 */
export function tagsIndicateInstalled(tags) {
  const wire = readFlagWireFromTags(parseProxmoxTags(tags), INSTALLED.name)
  if (wire === undefined) return false
  try {
    return jsonCodec(INSTALLED.schema).decode(wire) === true
  } catch {
    return false
  }
}

/**
 * Keep all `qctl.*` tags from live cfg when reconcile builds a new form.
 * Mutates and returns `form`.
 * @param {Record<string, string | number | boolean | undefined | null>} form
 * @param {QemuConfig | null | undefined} cfg
 * @returns {typeof form}
 */
export function preserveQctlFlagTagsOnForm(form, cfg) {
  const live = parseProxmoxTags(cfg?.tags).filter((t) => t.startsWith(SCOPE))
  if (!live.length) return form
  const merged = [...parseProxmoxTags(form.tags), ...live]
  form.tags = formatProxmoxTags(merged)
  return form
}

/**
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @returns {VmFlagStore}
 */
export function createFlagStore(client, vmid) {
  const path = () => `/nodes/${encodeURIComponent(client.config.node)}/qemu/${vmid}/config`

  /**
   * @returns {Promise<string[]>}
   */
  async function loadTags() {
    const cfg = await client.qemuConfig(vmid)
    return parseProxmoxTags(cfg?.tags)
  }

  /**
   * @param {string} next
   * @param {string[]} prev
   */
  async function writeTags(next, prev) {
    const prevFmt = formatProxmoxTags(prev)
    if (next === prevFmt) return
    if (!next) {
      await client.put(pveUnknown, path(), { delete: 'tags' })
      return
    }
    await client.put(pveUnknown, path(), { tags: next })
  }

  return {
    async has(flag) {
      return readFlagWireFromTags(await loadTags(), flag.name) !== undefined
    },

    async get(flag) {
      const wire = readFlagWireFromTags(await loadTags(), flag.name)
      if (wire === undefined) throw new VmFlagNotFoundError(flag.name)
      return jsonCodec(flag.schema).decode(wire)
    },

    async set(flag, value) {
      const prev = await loadTags()
      const wire = jsonCodec(flag.schema).encode(value)
      const next = withFlagWire(formatProxmoxTags(prev), flag.name, wire)
      await writeTags(next, prev)
    },

    async delete(flag) {
      const prev = await loadTags()
      const next = withFlagWire(formatProxmoxTags(prev), flag.name, undefined)
      await writeTags(next, prev)
    },

    async entry(flag) {
      const value = await this.get(flag)
      return { name: flag.name, schema: flag.schema, value }
    },
  }
}
