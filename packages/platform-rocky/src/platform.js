/**
 * Rocky platform module: capability → package map + OS install hook + networking.
 * Staged onto the guest as `qctl-platform-rocky.mjs` and dynamically `import()`ed.
 *
 * Host reads {@link CLOUD_IMAGE} from this module after downloading the plugin
 * (no host compile-time embed of the pin).
 */
import { definePlatform } from '@qctl/shared/platform/define'

import { installPackages } from './install-packages.js'
import { rockyNetworking } from './networking.js'
import { rockyPackagesMap } from './packages-map.js'

/** Supported `disks.data.*.fs` values (capability keys on {@link rockyPackagesMap}). */
export const FILESYSTEMS = Object.freeze(/** @type {const} */ (['xfs', 'ext4']))

/** Default data filesystem when provision omits `fs`. */
export const DEFAULT_FS = /** @type {typeof FILESYSTEMS[number]} */ ('xfs')

/** Default OS disk when provision `disks.os` is omitted/empty. */
export const OS_DISK = Object.freeze({ id: 'os', size: '20G' })

export { CLOUD_IMAGE } from './cloud-image.js'
export { installPackages } from './install-packages.js'
export { rockyNetworking } from './networking.js'
export { rockyPackagesMap } from './packages-map.js'

export const platform = definePlatform({
  id: 'rocky',
  packages: rockyPackagesMap,
  installPackages,
  networking: rockyNetworking,
  filesystems: FILESYSTEMS,
  defaultFs: DEFAULT_FS,
  osDisk: OS_DISK,
})
