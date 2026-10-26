/** Package-facing role / init profile / stage name types (type-only). */

export type QctlRole = 'host' | 'guest' | 'platform'

export type InitProfile = 'default' | 'init-tank'

export type PlatformStage =
  | 'ensure-dummies'
  | 'network-up'
  | 'host-baseline'
  | 'data-mounts'
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
