/**
 * Copy / materialize the Rocky seed kit (cloud-init / first-boot / lib).
 * Bun `--asset` trees can list names that are not readable; skip those holes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isSeedRoot } from './seed-root.js'

/**
 * @param {string} src
 * @param {string} dest
 */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) {
      copyTree(from, to)
      continue
    }
    if (!ent.isFile()) continue
    try {
      writeFileSync(to, readFileSync(from))
    } catch {
      // Hole in the embedded tree — skip.
    }
  }
}

/**
 * @param {string} src
 * @param {string} dest
 */
export function copySeedKit(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const name of ['cloud-init', 'first-boot', 'lib']) {
    const from = join(src, name)
    if (!existsSync(from)) {
      throw new Error(`seed kit missing ${name}/ under ${src}`)
    }
    copyTree(from, join(dest, name))
  }
  if (!isSeedRoot(dest)) {
    throw new Error(`export incomplete: ${dest} has no cloud-init/user-data.yaml`)
  }
}
