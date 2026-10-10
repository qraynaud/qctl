/** Package-facing role / init profile / stage name types (type-only). */

export type QctlRole = 'host' | 'guest' | 'platform'

export type InitProfile = 'default' | 'init-tank'

export type PlatformStage =
  | 'network-up'
  | 'host-baseline'
  | 'vw-mount'
  | 'tier0-seal'
  | 'ssh-host-keys'
  | 'admin-user'
  | 'start-services'
  | 'registry-login'
  | 'tank-import'
  | 'zfs-drill'
  | 'hg-clone'
  | 'ready-stamp'
  | 'tank-create'
  | 'poweroff'

export type PlatformStageContext = {
  profile: InitProfile
  dryRun?: boolean
}

/** Contract between guest `qctl init` and a platform stage runner (legacy CLI shape). */
export type PlatformAdapter = {
  name: string
  runStage: (stage: PlatformStage, ctx: PlatformStageContext) => Promise<void>
}
