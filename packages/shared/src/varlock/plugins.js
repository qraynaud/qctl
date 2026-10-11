import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { internal } from 'varlock'

/**
 * @typedef {{ moduleName: string, version: string, descriptor: string }} NpmPluginPin
 */

/** `# @plugin(name@version)` — local paths / unversioned pins are ignored. */
const PLUGIN_RE = /#\s*@plugin\(\s*([^)\s]+)\s*\)/g

/**
 * Collect exact npm `@plugin(name@version)` pins from env-spec text.
 * Skips local paths and unversioned specs (binary/cache mode needs an exact version).
 *
 * @param {string} text
 * @returns {NpmPluginPin[]}
 */
export function collectNpmPluginPins(text) {
  /** @type {Map<string, NpmPluginPin>} */
  const byDescriptor = new Map()
  for (const match of text.matchAll(PLUGIN_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('file:')) continue
    const at = raw.lastIndexOf('@')
    if (at <= 0) continue
    const moduleName = raw.slice(0, at)
    const version = raw.slice(at + 1)
    if (!moduleName || !version || version.includes('/') || version.includes('..')) continue
    const descriptor = `${moduleName}@${version}`
    byDescriptor.set(descriptor, { moduleName, version, descriptor })
  }
  return [...byDescriptor.values()]
}

/**
 * Scan a directory for `.env*` files and collect npm plugin pins.
 *
 * @param {string} dir
 * @returns {NpmPluginPin[]}
 */
export function collectNpmPluginPinsFromDir(dir) {
  /** @type {Map<string, NpmPluginPin>} */
  const byDescriptor = new Map()
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  for (const name of names) {
    if (!name.startsWith('.env')) continue
    let text
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const pin of collectNpmPluginPins(text)) {
      byDescriptor.set(pin.descriptor, pin)
    }
  }
  return [...byDescriptor.values()]
}

/**
 * Download npm plugins into `$XDG_CONFIG_HOME/varlock/plugins-cache` (or the
 * default user varlock dir). Same path as `varlock install-plugin` — no TTY confirm.
 * Requires the bun patch that exposes `internal.downloadPluginToCache`.
 *
 * @param {NpmPluginPin[]} pins
 * @param {{ xdgConfigHome?: string }} [opts]
 * @returns {Promise<string[]>} cache directories for each pin
 */
export async function prefetchNpmPlugins(pins, opts = {}) {
  const download = internal.downloadPluginToCache
  if (typeof download !== 'function') {
    throw new Error(
      'varlock.internal.downloadPluginToCache missing — apply patches/varlock@*.patch (bun install)',
    )
  }
  if (pins.length === 0) return []

  const prevXdg = process.env.XDG_CONFIG_HOME
  if (opts.xdgConfigHome !== undefined) {
    process.env.XDG_CONFIG_HOME = opts.xdgConfigHome
  }
  try {
    /** @type {string[]} */
    const cached = []
    for (const pin of pins) {
      cached.push(await download(pin.moduleName, pin.version))
    }
    return cached
  } finally {
    if (opts.xdgConfigHome !== undefined) {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
    }
  }
}

/**
 * Ensure every `# @plugin(name@version)` pin under `dir` is in plugins-cache
 * (guest install / graph load — replaces host seed prefetch).
 *
 * @param {string} dir
 * @param {{ xdgConfigHome?: string }} [opts]
 * @returns {Promise<{ pins: NpmPluginPin[], cached: string[] }>}
 */
export async function ensureNpmPluginsFromDir(dir, opts = {}) {
  const pins = collectNpmPluginPinsFromDir(dir)
  if (pins.length === 0) return { pins, cached: [] }
  const cached = await prefetchNpmPlugins(pins, opts)
  return { pins, cached }
}
