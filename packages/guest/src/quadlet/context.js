/**
 * Quadlet run context: instance root + injectable system/logging.
 */

import { resolve } from 'node:path'

import { findInstanceRoot, isInstanceRoot } from '@qctl/shared'

import { die } from './errors.js'
import { createSystem } from './system.js'
/** @import { System } from './system.js' */

/**
 * @typedef {object} QuadletContext
 * @property {string} root                 instance root (provision/ + qctl:)
 * @property {System} sys
 * @property {Record<string, string | undefined>} baseEnv
 * @property {string} seedDir
 *   seed-baked env dir (vlan-parents.env, …)
 * @property {(msg: string) => void} log   `quadlet: …`
 * @property {(msg: string) => void} print plain stdout line
 */

export const DEFAULT_SEED_DIR = '/usr/local/lib/rocky'

/**
 * Resolve the instance root: explicit `--root` / QCTL_ROOT, else walk up from cwd.
 * @param {{ root?: string, cwd?: string, env?: Record<string, string | undefined> }} [opts]
 * @returns {string}
 */
export function resolveInstanceRoot(opts = {}) {
  const env = opts.env ?? process.env
  const explicit = opts.root ?? env.QCTL_ROOT
  if (explicit) {
    const r = resolve(explicit)
    if (!isInstanceRoot(r))
      die(`${r} is not a qctl instance (need provision/*.yaml with a qctl: block)`)
    return r
  }
  const found = findInstanceRoot(opts.cwd ?? process.cwd())
  if (!found) {
    die(
      'no qctl instance found (need provision/ with a qctl: block); '
        + 'run from the repo or pass --root',
    )
  }
  return found
}

/**
 * @param {{
 *   root: string,
 *   sys?: System,
 *   baseEnv?: Record<string, string | undefined>,
 *   seedDir?: string,
 *   log?: (msg: string) => void,
 *   print?: (msg: string) => void,
 * }} opts
 * @returns {QuadletContext}
 */
export function createContext(opts) {
  const baseEnv = opts.baseEnv ?? process.env
  return {
    root: opts.root,
    sys: opts.sys ?? createSystem({ env: baseEnv }),
    baseEnv,
    seedDir: opts.seedDir ?? baseEnv.QCTL_SEED_DIR ?? DEFAULT_SEED_DIR,
    log: opts.log ?? ((m) => console.log(`quadlet: ${m}`)),
    print: opts.print ?? ((m) => console.log(m)),
  }
}
