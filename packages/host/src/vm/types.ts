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

/** Parsed yargs argv for vm commands (known fields; yargs may add more). */
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
  connect: string
  /** Resolved by `resolveDriver` (resolveBootResources via module id). */
  memory: number
  vcpus: number
  network: import('./driver-contract.js').VmNetwork | string
  osinfo: string
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
