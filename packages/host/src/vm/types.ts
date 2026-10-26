/**
 * Shared CLI / driver shapes for `qctl vm`.
 *
 * Thin driver module contract: {@link ./driver-contract.js}.
 * Runtime branded ids: {@link ./drivers/id.js}.
 */

/**
 * Builtin profile target literals (CLI/provision today).
 * Open branded ids for new backends: {@link import('./driver-contract.js').VmDriverId}.
 */
export type VmTarget = 'workstation' | 'proxmox'

/** @see import('./driver-contract.js').VmEnv */
export type VmEnv = import('./driver-contract.js').VmEnv

/** Seed ISO kind — same as {@link import('./driver-contract.js').VmSeedProfile}. */
export type SeedProfile = import('./driver-contract.js').VmSeedProfile

/**
 * Parsed yargs argv for vm commands (known fields; yargs may add more).
 *
 * Guest shape (memory/vcpus, NICs, osinfo) comes from provision / driver defaults —
 * not CLI overrides. {@link import('../lib/options.js').resolveBootResources} fills
 * memory/vcpus from `<target>.memory|cpu` before {@link import('./context.js').toVmSpecs}.
 */
export type VmArgv = {
  _: (string | number)[]
  $0: string
  /** Builtin union or future driver id string until branded in `loadBackend`. */
  target: VmTarget | string
  env: import('./driver-contract.js').VmEnv
  /** From profile / `qctl.environments.*.production` when resolved. */
  production?: boolean
  /** Provision profile key (`qctl.profiles`); set by resolveProfileArgv. */
  profile?: string
  /** Idempotency marker for resolveProfileArgv. */
  _qctlProfileResolved?: boolean
  /** Seed ISO kind (`--seed-profile`); not the provision profile. */
  seedProfile?: SeedProfile | string
  /** Resolved by `resolveDriver` (module.defaultVmName). */
  name: string
  /** libvirt URI (workstation); ignored for proxmox. */
  connect?: string
  /**
   * From provision `<target>.memory` via {@link import('../lib/options.js').resolveBootResources}.
   * Not a CLI flag.
   */
  memory: number
  /**
   * From provision `<target>.cpu` via {@link import('../lib/options.js').resolveBootResources}.
   * Not a CLI flag.
   */
  vcpus: number
  /** Keep unpacked cidata tree (debug; same as `vm seed --out`). */
  cidata?: string
  dryRun: boolean
  wipeOs?: boolean
  /** destroy: keep data + tank members (drop OS only). */
  keepPersistent?: boolean
  /** destroy CLI: skip prompts; only valid with keepPersistent. */
  yes?: boolean
  timeout: number
  forceDownload?: boolean
  /** init-tank: recreate pool on existing tank members. */
  force?: boolean
  /** init-tank: pool ids from disks.tanks (bare = all). */
  poolIds?: string[]
  allowMissingFiles?: boolean
  allowMissingTier0?: boolean
  out?: string
  instanceId?: string
  noConsole?: boolean
  signal?: AbortSignal
}

export type { PortEntry, PortsMap } from '../provision/schema/types.js'
