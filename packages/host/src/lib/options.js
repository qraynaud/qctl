import { loadProvisionDocument } from '@qctl/shared'

import { portsSchema } from '../provision/schema/index.js'
import { tryGetRepoRoot } from './paths.js'
import { sharedProfile } from './profile-argv.js'
import { TARGETS } from './target.js'

export { sharedProfile } from './profile-argv.js'

/** @import { Argv } from 'yargs' */
/** @import { YamlValue } from '@qctl/shared' */
/** @import { PortsMap, VmArgv, VmTarget } from '../vm/types.js' */

/** @typedef {{ memory?: string | number, cpu?: string | number }} BootResourceSection */

/**
 * Unresolved provision YAML (no !env / varlock). For yargs builders and CLI defaults only.
 * Internal `env` / `target` / `profile` come from the selected profile (see resolveProfileArgv).
 * @param {{ env?: string, target?: string, profile?: string }} [argv]
 */
function loadProvisionUnresolved(argv = {}) {
  const root = tryGetRepoRoot()
  if (!root) return null
  const env = argv.env || 'dev'
  const profile = argv.profile
  if (profile == null || String(profile).trim() === '') return null
  const target = /** @type {VmTarget} */ (
    argv.target && /** @type {readonly string[]} */ (TARGETS).includes(argv.target)
      ? argv.target
      : 'workstation'
  )
  try {
    return loadProvisionDocument({ root, env, target, profile })
  } catch {
    return null
  }
}

/**
 * Ports from provision for the resolved profile env/target (defaults to built-in dev/workstation).
 * @param {Partial<VmArgv>} [argv]
 * @returns {PortsMap}
 */
export function portsFromArgv(argv = {}) {
  const empty = () => portsSchema.parse({})
  const doc = loadProvisionUnresolved(argv)
  if (!doc) return empty()
  const networking = doc.data?.networking
  if (!networking || typeof networking !== 'object' || Array.isArray(networking)) return empty()
  const ports = /** @type {{ ports?: YamlValue }} */ (networking).ports
  if (ports == null) return empty()
  try {
    return portsSchema.parse(ports)
  } catch {
    return empty()
  }
}

/**
 * Shared VM identity flags (name / libvirt URI). Env + target come from the profile.
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedLibvirt = (y) =>
  sharedProfile(y)
    .option('name', {
      type: 'string',
      describe: 'VM / domain name (default: rocky; Proxmox production: rocky, else rocky-<env>)',
    })
    .option('connect', {
      type: 'string',
      default: process.env.QCTL_LIBVIRT_URI || 'qemu:///system',
      describe: 'libvirt URI (qemu:///system or qemu:///session); ignored for proxmox target',
    })

/**
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedDryRun = (y) =>
  y.option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Print actions without changing the host/guest',
  })

export const DEFAULT_CPU = 2
export const DEFAULT_MEMORY_MIB = 4096

/**
 * Fill argv.memory / argv.vcpus from provision workstation|proxmox.memory|cpu when CLI omits them.
 * Mutates argv (same pattern as resolveVmName). Soft-loads config (never exits).
 * @param {VmArgv} argv
 * @returns {VmArgv}
 */
export function resolveBootResources(argv) {
  /** @type {BootResourceSection | null} */
  let section = null
  if (argv.memory == null || argv.vcpus == null) {
    const doc = loadProvisionUnresolved({
      env: argv.env || 'dev',
      target: argv.target || 'workstation',
      profile: argv.profile,
    })
    if (doc?.data) {
      const block = argv.target === 'proxmox' ? doc.data.proxmox : doc.data.workstation
      section =
        block && typeof block === 'object' && !Array.isArray(block)
          ? /** @type {BootResourceSection} */ (block)
          : null
    }
  }
  if (argv.memory == null) {
    argv.memory = section?.memory != null ? Number(section.memory) : DEFAULT_MEMORY_MIB
  }
  if (argv.vcpus == null) {
    argv.vcpus = section?.cpu != null ? Number(section.cpu) : DEFAULT_CPU
  }
  return argv
}

/**
 * Disk / CPU / network flags for `vm up` and `vm init-tank`.
 * Disk sizes and passt hostfwd come from provision (not CLI).
 *
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedBoot = (y) =>
  sharedLibvirt(y)
    .option('memory', {
      type: 'number',
      describe: 'RAM MiB (default: provision workstation/proxmox.memory, else 4096)',
    })
    .option('vcpus', {
      type: 'number',
      describe: 'vCPU count (default: provision workstation/proxmox.cpu, else 2)',
    })
    .option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe:
        'user/auto: passt + hostfwd from provision ports; default: libvirt NAT virbr0 (workstation)',
    })
    .option('osinfo', {
      type: 'string',
      default: 'rocky10',
      describe: 'osinfo short-id (workstation)',
    })
    .option('cidata', {
      type: 'string',
      describe: 'Keep unpacked cidata tree at this path (debug; same as `vm seed --out`)',
    })
