import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root (parent of `tooling/`). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Loose JSON shapes for tooling configs (`*` — recursive JSON typedefs break tsc).
 * @typedef {*} JsonValue
 * @typedef {{ [key: string]: * }} JsonObject
 */

/**
 * @param {string} path
 * @returns {JsonObject}
 */
export function readJson(path) {
  return /** @type {JsonObject} */ (JSON.parse(readFileSync(path, 'utf8')))
}
