/**
 * Shared CLI / driver shapes for `qctl vm`.
 */

export type VmTarget = 'local' | 'proxmox'
export type VmEnv = 'dev' | 'prod'
export type VmNetwork = 'auto' | 'default' | 'user'
export type SeedProfile = 'appliance' | 'init-tank'

/** Parsed yargs argv for vm commands (known fields; yargs may add more). */
export type VmArgv = {
  _: (string | number)[]
  $0: string
  target: VmTarget | string
  env: VmEnv | string
  /** Resolved by `loadDriver` (resolveVmName). */
  name: string
  connect: string
  /** Resolved by `loadDriver` (resolveBootResources). */
  memory: number
  vcpus: number
  network: VmNetwork | string
  osinfo: string
  cidata?: string
  vwSize: string
  dataSize: string
  specialSize: string
  sshPort?: number
  cockpitPort?: number
  caddyHttpPort?: number
  caddyHttpsPort?: number
  dryRun: boolean
  wipeOs?: boolean
  keepData?: boolean
  timeout: number
  forceDownload?: boolean
  force?: boolean
  allowMissingFiles?: boolean
  allowMissingTier0?: boolean
  profile?: SeedProfile | string
  out?: string
  instanceId?: string
  noConsole?: boolean
  signal?: AbortSignal
}

export type PortEntry = {
  name: string
  port: number
  forward: number | null
  dnat: number | null
}

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
