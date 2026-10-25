/**
 * Driver registry: branded id → {@link VmDriverRegistration}.
 */
import { die } from '../../lib/util.js'
import { vmDriverIdSchema } from './id.js'

/** @import { DefaultVmNameOpts, VmDriverId, VmDriverRegistration } from '../driver-contract.js' */

/** @type {Map<string, VmDriverRegistration>} */
const drivers = new Map()

/**
 * @param {VmDriverRegistration} mod
 */
export function registerDriver(mod) {
  const key = String(mod.id)
  if (drivers.has(key)) die(`vm driver already registered: ${key}`)
  drivers.set(key, mod)
}

/**
 * @param {VmDriverId | string} id
 * @returns {VmDriverRegistration | undefined}
 */
export function getDriverModule(id) {
  return drivers.get(String(id))
}

/**
 * @returns {VmDriverId[]}
 */
export function listDriverIds() {
  return [...drivers.keys()].map((k) => vmDriverIdSchema.parse(k))
}

/**
 * Brand a raw target string and require a registered module.
 * @param {string} raw
 * @returns {VmDriverId}
 */
export function asVmDriverId(raw) {
  let id
  try {
    id = vmDriverIdSchema.parse(raw)
  } catch {
    die(`unknown target ${raw}`)
  }
  if (!getDriverModule(id)) die(`unknown target ${raw}`)
  return id
}

/**
 * @param {VmDriverRegistration} mod
 * @param {DefaultVmNameOpts & { name?: string }} opts
 * @returns {string}
 */
export function resolveNameForModule(mod, opts) {
  const name =
    opts.name != null && String(opts.name).trim() !== '' ? String(opts.name).trim() : null
  if (name) return name
  if (mod.defaultVmName) return mod.defaultVmName(opts)
  return 'rocky'
}

/** Test helper — clear registry between tests. */
export function _resetDriverRegistryForTests() {
  drivers.clear()
}

/**
 * Test helper — drop one id (e.g. a temporary third driver) without wiping builtins.
 * @param {VmDriverId | string} id
 */
export function _unregisterDriverForTests(id) {
  drivers.delete(String(id))
}
