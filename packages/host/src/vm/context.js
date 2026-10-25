/**
 * CLI argv → {@link VmContext} / partial {@link VmSpecs} at the driver edge.
 */
/** @import { VmContext, VmSpecs } from './driver-contract.js' */
/** @import { VmArgv } from './types.js' */

/**
 * Build a {@link VmContext} from resolved yargs argv.
 * Call after profile / name are filled (see {@link resolveDriver}).
 * Guest shape is {@link toVmSpecs} — not on context.
 *
 * @param {VmArgv} argv
 * @returns {VmContext}
 */
export function toVmContext(argv) {
  if (argv.name == null || String(argv.name).trim() === '') {
    throw new Error('toVmContext: argv.name is required (resolve via resolveDriver first)')
  }
  return {
    env: argv.env || 'dev',
    profile: argv.profile,
    production: argv.production,
    name: String(argv.name).trim(),
    dryRun: Boolean(argv.dryRun),
    timeout: Number(argv.timeout) || 0,
    signal: argv.signal,
    connect: argv.connect,
  }
}

/**
 * Argv-derived guest fields (memory/vcpus/network/osinfo) for soft reconcile
 * or as the base merged into full {@link VmSpecs} by host prep.
 *
 * @param {VmArgv} argv
 * @returns {Partial<VmSpecs>}
 */
export function toVmSpecs(argv) {
  if (argv.memory == null || argv.vcpus == null) {
    throw new Error('toVmSpecs: argv.memory and argv.vcpus are required (resolveBootResources)')
  }
  return {
    memory: Number(argv.memory),
    vcpus: Number(argv.vcpus),
    network: argv.network,
    osinfo: argv.osinfo,
  }
}
