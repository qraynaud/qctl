/**
 * Shared CLI / driver shapes for `qctl vm`.
 */

export type VmTarget = 'local' | 'proxmox'
/** Provision / QCTL_ENV name (open; declared in `qctl.environments`). */
export type VmEnv = string
export type VmNetwork = 'auto' | 'default' | 'user'
export type SeedProfile = 'appliance' | 'init-tank'

/** Parsed yargs argv for vm commands (known fields; yargs may add more). */
export type VmArgv = {
  _: (string | number)[]
  $0: string
  target: VmTarget | string
  env: VmEnv
  /** From profile / `qctl.environments.*.production` when resolved. */
  production?: boolean
  /** Provision profile key (`qctl.profiles`); set by resolveProfileArgv. */
  profile?: string
  /** Idempotency marker for resolveProfileArgv. */
  _qctlProfileResolved?: boolean
  /** Seed ISO kind (`--seed-profile`); not the provision profile. */
  seedProfile?: SeedProfile | string
  /** Resolved by `loadDriver` (resolveVmName). */
  name: string
  connect: string
  /** Resolved by `loadDriver` (resolveBootResources). */
  memory: number
  vcpus: number
  network: VmNetwork | string
  osinfo: string
  cidata?: string
  dryRun: boolean
  wipeOs?: boolean
  /** destroy: keep data + tank members (drop OS only). */
  keepPersistent?: boolean
  /** destroy: skip prompts; only valid with keepPersistent. */
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

export type VmDriver = {
  id: 'local' | 'proxmox'
  check: (argv: VmArgv) => Promise<void>
  up: (argv: VmArgv) => Promise<void>
  down: (argv: VmArgv) => Promise<void>
  destroy: (argv: VmArgv) => Promise<void>
  status: (argv: VmArgv) => Promise<void>
  initTank: (argv: VmArgv) => Promise<void>
  sshInfo: (argv: VmArgv) => Promise<void>
}
