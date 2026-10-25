/**
 * Proxmox VE driver — PVE JSON API.
 * Disks follow provision topology (attach-mode: size → virtual, else physical).
 */
import { BUILTIN_ENVIRONMENTS, isProductionEnv } from '@qctl/shared'

import { die } from '../../lib/util.js'
import { createFlagStore as createProxmoxFlagStore } from '../libs/proxmox/flag-store.js'
import { vmDriverIdSchema } from './id.js'
import { check } from './proxmox/check.js'
import * as ops from './proxmox/ops.js'
import { refineProvision } from './proxmox/provision-refine.js'
import { clientFrom } from './proxmox/shared.js'
import { getStatus } from './proxmox/status.js'
import { registerDriver } from './registry.js'

/**
 * @import {
 *   DefaultVmNameOpts,
 *   VmContext,
 *   VmDriverRegistration,
 *   VmFlagStore,
 * } from '../driver-contract.js'
 */

/** Branded driver id — owned by this module. */
export const id = vmDriverIdSchema.parse('proxmox')

/** @type {string} */
export const scaffoldHint = 'remote Proxmox VE'

/**
 * Fallback when `templates/provision/target-proxmox.yaml.njk` is missing.
 * @returns {string}
 */
export function scaffoldTargetYaml() {
  return `# Defaults for profiles with target: proxmox.

proxmox:
  api_url: https://pve.example:8006
  api_token: SET_PROXMOX_API_TOKEN
  node: pve
  cpu: 2
  memory: 4096
`
}

/**
 * @param {DefaultVmNameOpts} opts
 * @returns {string}
 */
export function defaultVmName({ env, production, environments }) {
  const envName = env != null && String(env).trim() !== '' ? String(env).trim() : 'dev'
  const isProd = production ?? isProductionEnv(envName, environments ?? BUILTIN_ENVIRONMENTS)
  return isProd ? 'rocky' : `rocky-${envName}`
}

/**
 * Flag store for the PVE guest named `ctx.name` (looks up vmid).
 * @param {VmContext} ctx
 * @returns {Promise<VmFlagStore>}
 */
export async function createFlagStore(ctx) {
  if (!ctx.name || String(ctx.name).trim() === '') {
    die('proxmox createFlagStore: ctx.name is required')
  }
  const name = String(ctx.name).trim()
  const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
  const vmid = await client.findVmidByName(name)
  if (vmid == null) die(`proxmox createFlagStore: no VM named ${JSON.stringify(name)}`)
  return createProxmoxFlagStore(client, vmid)
}

/** @type {VmDriverRegistration} */
export const module = {
  id,
  defaultVmName,
  createFlagStore,
  provisionOverlaySchema: ops.provisionOverlaySchema,
  refineProvision,
  scaffoldHint,
  scaffoldTargetYaml,
  powerState: ops.powerState,
  resolveEndpoint: ops.resolveEndpoint,
  find: ops.find,
  create: ops.create,
  // Handle erased at registry boundary (THandle = unknown).
  start: /** @type {VmDriverRegistration['start']} */ (ops.start),
  stop: /** @type {VmDriverRegistration['stop']} */ (ops.stop),
  destroy: /** @type {VmDriverRegistration['destroy']} */ (ops.destroy),
  reconcile: /** @type {VmDriverRegistration['reconcile']} */ (ops.reconcile),
  detachSeed: /** @type {VmDriverRegistration['detachSeed']} */ (ops.detachSeed),
  collectCheckFacts: ops.collectCheckFacts,
  targetCheck: check,
  getStatus,
}

registerDriver(module)
