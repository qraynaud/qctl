import { loadProvisionDocument } from '@qctl/shared'

import { DATA_COUNT, SPECIAL_COUNT, tryGetRepoRoot } from './paths.js'
import { addPasstPortOptions } from './ports.js'
import { parsePorts } from './secrets-schema.js'
import { ENVS, TARGETS } from './target.js'

/** @import { Argv } from 'yargs' */
/** @import { YamlValue } from '@qctl/shared' */
/** @import { PortEntry, VmArgv, VmTarget } from '../types.js' */

/** @typedef {{ memory?: string | number, cpu?: string | number }} BootResourceSection */

export { addPasstPortOptions } from './ports.js'

/**
 * Unresolved provision YAML (no !env / varlock). For yargs builders and CLI defaults only.
 * @param {{ env?: string, target?: string }} [argv]
 */
function loadProvisionUnresolved(argv = {}) {
  const root = tryGetRepoRoot()
  if (!root) return null
  const env = argv.env || 'dev'
  const target = /** @type {VmTarget} */ (
    argv.target && /** @type {readonly string[]} */ (TARGETS).includes(argv.target)
      ? argv.target
      : 'local'
  )
  try {
    return loadProvisionDocument({ root, env, target })
  } catch {
    return null
  }
}

/**
 * Ports from provision for the given --env / --target (defaults to dev/local).
 * @param {Partial<VmArgv>} [argv]
 * @returns {PortEntry[]}
 */
export function portsFromArgv(argv = {}) {
  const doc = loadProvisionUnresolved(argv)
  if (!doc) return []
  const networking = doc.data?.networking
  if (!networking || typeof networking !== 'object' || Array.isArray(networking)) return []
  const ports = /** @type {{ ports?: YamlValue }} */ (networking).ports
  if (ports == null) return []
  try {
    return parsePorts(ports, doc.basePath)
  } catch {
    return []
  }
}

function portsForBuilderDefaults() {
  return portsFromArgv({
    env: process.env.QCTL_ENV || 'dev',
    target: process.env.QCTL_TARGET || 'local',
  })
}

/**
 * --target / --env (local libvirt vs Proxmox; dev vs prod).
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedTarget = (y) =>
  y
    .option('target', {
      choices: /** @type {string[]} */ ([...TARGETS]),
      default: 'local',
      describe: 'local = libvirt; proxmox = PVE API (token via !env in provision/)',
    })
    .option('env', {
      choices: /** @type {string[]} */ ([...ENVS]),
      default: 'dev',
      describe: '.env.dev vs .env.prod; Proxmox default name rocky-dev (dev) or rocky (prod)',
    })

/**
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedLibvirt = (y) =>
  sharedTarget(y)
    .option('name', {
      type: 'string',
      describe: 'VM / domain name (default: rocky; Proxmox: rocky-dev or rocky for prod)',
    })
    .option('connect', {
      type: 'string',
      default: process.env.QCTL_LIBVIRT_URI || 'qemu:///system',
      describe: 'libvirt URI (qemu:///system or qemu:///session); ignored for --target proxmox',
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
 * Fill argv.memory / argv.vcpus from provision local|proxmox.memory|cpu when CLI omits them.
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
      target: argv.target || 'local',
    })
    if (doc?.data) {
      const block = argv.target === 'proxmox' ? doc.data.proxmox : doc.data.local
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
 * Passt `--*-port` overrides belong on `vm up` only (init-tank has no SSH/cockpit/caddy).
 *
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedBoot = (y) =>
  sharedLibvirt(y)
    .option('memory', {
      type: 'number',
      describe: 'RAM MiB (default: provision local/proxmox.memory, else 4096)',
    })
    .option('vcpus', {
      type: 'number',
      describe: 'vCPU count (default: provision local/proxmox.cpu, else 2)',
    })
    .option('vw-size', { type: 'string', default: '2G', describe: '/vw disk size' })
    .option('data-size', {
      type: 'string',
      default: '2G',
      describe: `Each of ${DATA_COUNT} RAIDZ2 data vdev disks`,
    })
    .option('special-size', {
      type: 'string',
      default: '1G',
      describe: `Each of ${SPECIAL_COUNT} special-mirror disks`,
    })
    .option('network', {
      choices: ['auto', 'default', 'user'],
      default: 'user',
      describe:
        'user/auto: passt + hostfwd from provision ports; default: libvirt NAT virbr0 (local)',
    })
    .option('osinfo', { type: 'string', default: 'rocky9', describe: 'osinfo short-id (local)' })
    .option('cidata', {
      type: 'string',
      describe: 'Keep unpacked cidata tree at this path (debug; same as `vm seed --out`)',
    })

/**
 * Lab passt hostfwd CLI overrides (from provision networking.ports).
 * @param {Argv} y
 * @returns {Argv}
 */
export const sharedPasstPorts = (y) => addPasstPortOptions(y, portsForBuilderDefaults())
