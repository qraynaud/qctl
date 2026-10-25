/** @import { PlatformStage } from '@qctl/shared' */

/**
 * Appliance first boot (`rocky-first-boot.service` → `qctl _internal_init`).
 * @type {ReadonlyArray<PlatformStage>} */
export const DEFAULT_STAGES = [
  'vlan-parents',
  'network-up',
  'host-baseline',
  'data-mounts',
  'tier0-seal',
  'ssh-host-keys',
  'admin-user',
  'start-services',
  'registry-login',
  'tank-import',
  'zfs-drill',
  'hg-clone',
  'ready-stamp',
]

/**
 * `qctl vm init-tank` one-shot VM
 * (`rocky-init-tank-prep.service` → `qctl _internal_init --profile init-tank`).
 * Same Tier-0 seal path as appliance (`qctl _internal_stage tier0-seal` / in-process stage).
 * @type {ReadonlyArray<PlatformStage>}
 */
export const INIT_TANK_STAGES = ['tier0-seal', 'data-mounts', 'tank-create', 'poweroff']

/** @type {ReadonlyArray<'default' | 'init-tank'>} */
export const PROFILES = ['default', 'init-tank']

/** @type {Readonly<Record<'default' | 'init-tank', ReadonlyArray<PlatformStage>>>} */
export const PROFILE_STAGES = {
  default: DEFAULT_STAGES,
  'init-tank': INIT_TANK_STAGES,
}

/**
 * Every stage name runnable via `stage <name>` (default order first, then profile-only extras).
 * @type {ReadonlyArray<PlatformStage>} */
export const ALL_STAGES = [
  ...DEFAULT_STAGES,
  ...INIT_TANK_STAGES.filter((s) => !DEFAULT_STAGES.includes(s)),
]

/**
 * @param {string} profile
 * @returns {ReadonlyArray<PlatformStage>}
 */
export function stagesForProfile(profile) {
  const stages = PROFILE_STAGES[/** @type {'default' | 'init-tank'} */ (profile)]
  if (!stages) {
    throw new Error(`unknown profile: ${profile} (known: ${PROFILES.join(', ')})`)
  }
  return stages
}

/**
 * @param {string} name
 * @returns {name is PlatformStage}
 */
export function isStage(name) {
  return ALL_STAGES.includes(/** @type {PlatformStage} */ (name))
}
