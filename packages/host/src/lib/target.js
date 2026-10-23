/**
 * Deployment target (workstation libvirt vs Proxmox). Env names are open (`qctl.environments`).
 */

import { BUILTIN_ENVIRONMENTS, isProductionEnv } from '@qctl/shared'

/** @import { VmArgv, VmEnv, VmTarget } from '../vm/types.js' */

/** Profile / driver target values (not a user CLI flag). */
export const TARGETS = /** @type {const} */ (['workstation', 'proxmox'])

/**
 * Default libvirt/Proxmox VM name when --name is omitted.
 * Proxmox production → `rocky`; otherwise `rocky-<env>`.
 * @param {{
 *   target?: VmTarget | string,
 *   env?: VmEnv | string,
 *   production?: boolean,
 *   environments?: Record<string, { production?: boolean }>,
 * }} opts
 * @returns {string}
 */
export function defaultVmName({ target, env, production, environments }) {
  const envName = env != null && String(env).trim() !== '' ? String(env).trim() : 'dev'
  const isProd = production ?? isProductionEnv(envName, environments ?? BUILTIN_ENVIRONMENTS)
  if (target === 'proxmox') return isProd ? 'rocky' : `rocky-${envName}`
  return 'rocky'
}

/**
 * Resolve name after yargs parse. Call from handlers (middleware order is fragile
 * with commandDir).
 * @param {VmArgv} argv
 * @returns {string}
 */
export function resolveVmName(argv) {
  const name =
    argv.name != null && String(argv.name).trim() !== '' ? String(argv.name).trim() : null
  return (
    name
    || defaultVmName({
      target: argv.target,
      env: argv.env,
      production: argv.production,
    })
  )
}
