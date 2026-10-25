import { die } from '../../lib/util.js'
import { createFlagStore as createLibvirtFlagStore } from '../libs/libvirt/flag-store.js'
import { vmDriverIdSchema } from './id.js'
import { registerDriver } from './registry.js'
import { check } from './workstation/check.js'
import * as ops from './workstation/ops.js'
import { getStatus } from './workstation/status.js'

/**
 * @import {
 *   DefaultVmNameOpts,
 *   VmContext,
 *   VmDriverRegistration,
 *   VmFlagStore,
 * } from '../driver-contract.js'
 */

/** Branded driver id — owned by this module. */
export const id = vmDriverIdSchema.parse('workstation')

/** @type {string} */
export const scaffoldHint = 'VM on this machine'

/**
 * Fallback when `templates/provision/target-workstation.yaml.njk` is missing.
 * @returns {string}
 */
export function scaffoldTargetYaml() {
  return `# Defaults for profiles with target: workstation (VM on this machine).

workstation:
  cpu: 2
  memory: 4096
`
}

/**
 * @param {DefaultVmNameOpts} [_opts]
 * @returns {string}
 */
export function defaultVmName(_opts) {
  return 'rocky'
}

/**
 * Flag store for `ctx.name` on the libvirt URI in `ctx.connect`.
 * @param {VmContext} ctx
 * @returns {Promise<VmFlagStore>}
 */
export async function createFlagStore(ctx) {
  const connect = ops.connectOf(ctx)
  if (!ctx.name || String(ctx.name).trim() === '') {
    die('workstation createFlagStore: ctx.name is required')
  }
  return createLibvirtFlagStore(connect, String(ctx.name).trim())
}

/** @type {VmDriverRegistration} */
export const module = {
  id,
  defaultVmName,
  createFlagStore,
  provisionOverlaySchema: ops.provisionOverlaySchema,
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
