/**
 * Libvirt / workstation {@link VmFlagStore}: flags as scoped `<metadata>` elements
 * under a private XMLNS (`qctl:<name>` text = codec wire).
 */
import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { VmFlagNotFoundError, jsonCodec } from '../flags.js'
import { redefineDomainXml, stopDomainForRedefine } from './domain.js'
import { virsh } from './virsh.js'

/** @import { VmFlagDef, VmFlagStore } from '../flag-store.js' */

/** XMLNS for qctl VM flags (private to this target). */
const NS = 'https://qctl.dev/vm'

const META_OPEN = /<metadata(\s[^>]*)?>/i
const META_BLOCK = /<metadata(\s[^>]*)?>[\s\S]*?<\/metadata>/i

/**
 * @param {string} name
 * @returns {boolean}
 */
function isSafeFlagName(name) {
  return /^[a-z][a-z0-9-]*$/.test(name)
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeXmlText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * @param {string} s
 * @returns {string}
 */
function unescapeXmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/**
 * Read codec wire for `name` from domain XML, or `undefined` if absent.
 * @param {string} xml
 * @param {string} name
 * @returns {string | undefined}
 */
export function readFlagWireFromXml(xml, name) {
  if (!isSafeFlagName(name)) return undefined
  const blockMatch = META_BLOCK.exec(xml)
  if (!blockMatch) return undefined
  const block = blockMatch[0]
  const el = escapeRegExp(name)

  const nsEl = new RegExp(`<([a-zA-Z_][\\w.-]*):${el}\\b([^>]*)>([\\s\\S]*?)</\\1:${el}\\s*>`, 'i')
  const ns = nsEl.exec(block)
  if (ns) {
    const attrs = ns[2] || ''
    const prefix = ns[1]
    const hasNs =
      new RegExp(`xmlns:${prefix}\\s*=\\s*["']${escapeRegExp(NS)}["']`, 'i').test(attrs)
      || block.includes(NS)
    if (hasNs) return unescapeXmlText(ns[3].trim())
  }

  const defEl = new RegExp(`<${el}\\b([^>]*)>([\\s\\S]*?)</${el}\\s*>`, 'i')
  const def = defEl.exec(block)
  if (def) {
    const attrs = def[1] || ''
    if (new RegExp(`xmlns\\s*=\\s*["']${escapeRegExp(NS)}["']`, 'i').test(attrs)) {
      return unescapeXmlText(def[2].trim())
    }
  }
  return undefined
}

/**
 * @param {string} name
 * @param {string} wire
 * @returns {string}
 */
function flagElementXml(name, wire) {
  return `<qctl:${name} xmlns:qctl="${NS}">${escapeXmlText(wire)}</qctl:${name}>`
}

/**
 * @param {string} inner
 * @param {string} name
 * @returns {string}
 */
function stripFlagElements(inner, name) {
  const el = escapeRegExp(name)
  return inner
    .replace(new RegExp(`<([a-zA-Z_][\\w.-]*):${el}\\b[^>]*>[\\s\\S]*?</\\1:${el}\\s*>`, 'gi'), '')
    .replace(new RegExp(`<${el}\\b[^>]*>[\\s\\S]*?</${el}\\s*>`, 'gi'), '')
    .replace(new RegExp(`<([a-zA-Z_][\\w.-]*):${el}\\b[^/]*/>`, 'gi'), '')
    .replace(new RegExp(`<${el}\\b[^/]*/>`, 'gi'), '')
}

/**
 * Patch domain XML so flag `name` is set to `wire`, or removed when `wire` is undefined.
 * Returns null when unchanged.
 * @param {string} xml
 * @param {string} name
 * @param {string | undefined} wire
 * @returns {string | null}
 */
export function patchDomainFlagXml(xml, name, wire) {
  if (!isSafeFlagName(name)) return null
  const current = readFlagWireFromXml(xml, name)
  if (current === wire) return null
  if (current === undefined && wire === undefined) return null

  if (wire !== undefined) {
    const frag = flagElementXml(name, wire)
    if (META_BLOCK.test(xml)) {
      return xml.replace(META_BLOCK, (block) => {
        const open = META_OPEN.exec(block)
        if (!open) return block
        const openEnd = open.index + open[0].length
        const closeIdx = block.toLowerCase().lastIndexOf('</metadata>')
        const inner = stripFlagElements(block.slice(openEnd, closeIdx), name)
        return `${block.slice(0, openEnd)}\n    ${frag}${inner}${block.slice(closeIdx)}`
      })
    }
    if (/<devices\b/i.test(xml)) {
      return xml.replace(/<devices\b/i, `<metadata>\n    ${frag}\n  </metadata>\n  <devices`)
    }
    if (/<\/domain>/i.test(xml)) {
      return xml.replace(/<\/domain>/i, `  <metadata>\n    ${frag}\n  </metadata>\n</domain>`)
    }
    return null
  }

  if (!META_BLOCK.test(xml)) return null
  return xml.replace(META_BLOCK, (block) => {
    const open = META_OPEN.exec(block)
    if (!open) return block
    const openEnd = open.index + open[0].length
    const closeIdx = block.toLowerCase().lastIndexOf('</metadata>')
    const inner = stripFlagElements(block.slice(openEnd, closeIdx), name)
    const trimmed = inner.replace(/^\s+|\s+$/g, '')
    if (!trimmed) return ''
    return `${block.slice(0, openEnd)}${inner}${block.slice(closeIdx)}`
  })
}

/**
 * @param {string} connect
 * @param {string} name domain name
 * @returns {VmFlagStore}
 */
export function createFlagStore(connect, name) {
  /**
   * @returns {Promise<string>}
   */
  async function dumpxml() {
    const dump = await virsh(connect, 'dumpxml', name).nothrow()
    if (dump.exitCode !== 0) {
      die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
    }
    return String(dump.stdout)
  }

  /**
   * @param {string} flagName
   * @param {string | undefined} wire
   * @param {string} reason
   */
  async function applyWire(flagName, wire, reason) {
    const xml = await dumpxml()
    if (patchDomainFlagXml(xml, flagName, wire) == null) return

    await stopDomainForRedefine(connect, name, reason)

    const ok = await redefineDomainXml(
      connect,
      name,
      (cur) => patchDomainFlagXml(cur, flagName, wire),
      'flag-store',
    )
    if (ok) {
      console.log(
        chalk.dim(
          wire === undefined
            ? `vm: domain ${name} flag ${flagName} cleared`
            : `vm: domain ${name} flag ${flagName} set`,
        ),
      )
    }
  }

  /**
   * @returns {Promise<string | null>} domain XML, or null if the domain is missing
   */
  async function dumpxmlOrNull() {
    const dump = await virsh(connect, 'dumpxml', name).nothrow()
    if (dump.exitCode !== 0) return null
    return String(dump.stdout)
  }

  return {
    async has(flag) {
      const xml = await dumpxmlOrNull()
      if (xml == null) return false
      return readFlagWireFromXml(xml, flag.name) !== undefined
    },

    async get(flag) {
      const xml = await dumpxmlOrNull()
      if (xml == null) throw new VmFlagNotFoundError(flag.name)
      const wire = readFlagWireFromXml(xml, flag.name)
      if (wire === undefined) throw new VmFlagNotFoundError(flag.name)
      return jsonCodec(flag.schema).decode(wire)
    },

    async set(flag, value) {
      const wire = jsonCodec(flag.schema).encode(value)
      await applyWire(flag.name, wire, `set flag ${flag.name}`)
    },

    async delete(flag) {
      await applyWire(flag.name, undefined, `clear flag ${flag.name}`)
    },

    async entry(flag) {
      const value = await this.get(flag)
      return { name: flag.name, schema: flag.schema, value }
    },
  }
}
