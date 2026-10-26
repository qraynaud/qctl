/**
 * Quadlet run context: instance root + injectable system/logging.
 */

import { resolve } from 'node:path'

import { isInstanceRoot } from '@qctl/shared'

import { tryReadOsConfig } from '../../os-config.js'
import { die } from './errors.js'
import { createSystem } from './system.js'
/** @import { OsConfig } from '@qctl/shared' */
/** @import { System } from './system.js' */

/**
 * @typedef {object} QuadletContext
 * @property {string} root                 instance root from `/etc/qctl/config.json`
 * @property {System} sys
 * @property {Record<string, string | undefined>} baseEnv
 *   Ambient process env for spawn/varlock (PATH, CREDENTIALS_DIRECTORY, …) —
 *   not used for identity discovery.
 * @property {string} seedDir
 *   seed-baked env dir (`vlan-parents.env` → VLAN{n}_PARENT=iface, …)
 * @property {OsConfig} [osConfig]
 * @property {string} [qctlEnv]            optional CLI override for varlock graphs
 * @property {(msg: string) => void} log   `quadlet: …`
 * @property {(msg: string) => void} print plain stdout line
 */

export const DEFAULT_SEED_DIR = '/usr/local/lib/rocky'

/**
 * Resolve the instance root from `/etc/qctl/config.json` only (no `--root`, no cwd walk).
 *
 * @param {{
 *   osConfig?: OsConfig,
 *   osConfigPath?: string,
 * }} [opts]
 * @returns {string}
 */
export function resolveInstanceRoot(opts = {}) {
  const pathLabel = opts.osConfigPath ?? '/etc/qctl/config.json'
  const os = opts.osConfig ?? tryReadOsConfig(opts.osConfigPath)
  if (!os?.root?.trim()) {
    die(`missing instance root in ${pathLabel} (run guest init / re-seed)`)
  }
  const r = resolve(os.root.trim())
  if (!isInstanceRoot(r)) {
    die(`${r} from ${pathLabel} is not a qctl instance (need provision/*.yaml with a qctl: block)`)
  }
  return r
}

/**
 * @param {{
 *   root: string,
 *   sys?: System,
 *   baseEnv?: Record<string, string | undefined>,
 *   seedDir?: string,
 *   osConfig?: OsConfig,
 *   osConfigPath?: string,
 *   qctlEnv?: string,
 *   rootlessUser?: string,
 *   log?: (msg: string) => void,
 *   print?: (msg: string) => void,
 * }} opts
 * @returns {QuadletContext}
 */
export function createContext(opts) {
  const baseEnv = opts.baseEnv ?? process.env
  const osConfig = opts.osConfig ?? tryReadOsConfig(opts.osConfigPath)
  return {
    root: opts.root,
    sys:
      opts.sys
      ?? createSystem({
        rootlessUser: opts.rootlessUser ?? osConfig?.quadletUser,
      }),
    baseEnv,
    seedDir: opts.seedDir ?? DEFAULT_SEED_DIR,
    osConfig,
    qctlEnv: opts.qctlEnv,
    log: opts.log ?? ((m) => console.log(`quadlet: ${m}`)),
    print: opts.print ?? ((m) => console.log(m)),
  }
}
