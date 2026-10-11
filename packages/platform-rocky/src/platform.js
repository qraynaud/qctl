/**
 * Thin Rocky platform module: capability → package map + OS install hook + networking.
 * Staged onto the guest as `qctl-platform-rocky.mjs` and dynamically `import()`ed.
 * Keep this entry free of the heavy `@qctl/shared` barrel so the ESM bundle stays small;
 * guest validates with `definePlatform` after import.
 *
 * Host reads {@link CLOUD_IMAGE} from this module after downloading the plugin
 * (no host compile-time embed of the pin).
 */
import { installPackages } from './install-packages.js'
import { rockyNetworking } from './networking.js'
import { rockyPackagesMap } from './packages-map.js'

/** @import { PlatformModule } from '@qctl/shared' */

export { CLOUD_IMAGE } from './cloud-image.js'
export { installPackages } from './install-packages.js'
export { rockyNetworking } from './networking.js'
export { rockyPackagesMap } from './packages-map.js'

/** @type {PlatformModule} */
export const platform = {
  id: 'rocky',
  packages: rockyPackagesMap,
  installPackages,
  networking: rockyNetworking,
}
