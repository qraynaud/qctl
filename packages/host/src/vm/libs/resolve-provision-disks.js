/**
 * Load provision + platform disk defaults → {@link resolveDisks}.
 */
import { loadEnvProvisionOrThrow } from '../../lib/load-config.js'
import { resolveDisks } from '../../provision/schema/resolve-disks.js'
import { ensurePlatformModule } from '../../tooling/platform-tooling.js'

/** @import { LoadedProvision } from '../../lib/load-config-types.js' */
/** @import { ResolvedDisks } from '../../provision/schema/resolve-disks.js' */

/**
 * @param {string} modPath
 * @returns {Promise<{
 *   filesystems: readonly string[],
 *   defaultFs: string,
 *   osDisk: { id?: string, size?: string },
 * }>}
 */
async function platformDiskDefaultsFromModule(modPath) {
  const mod = await import(modPath)
  if (mod.platform?.filesystems && mod.platform?.defaultFs && mod.platform?.osDisk) {
    return {
      filesystems: mod.platform.filesystems,
      defaultFs: mod.platform.defaultFs,
      osDisk: mod.platform.osDisk,
    }
  }
  if (mod.FILESYSTEMS && mod.DEFAULT_FS && mod.OS_DISK) {
    return {
      filesystems: mod.FILESYSTEMS,
      defaultFs: mod.DEFAULT_FS,
      osDisk: mod.OS_DISK,
    }
  }
  throw new Error(
    `platform module ${modPath} missing disk defaults `
      + `(platform.filesystems/defaultFs/osDisk or FILESYSTEMS/DEFAULT_FS/OS_DISK)`,
  )
}

/**
 * @param {{
 *   env?: string,
 *   target?: string,
 *   provision?: LoadedProvision,
 * }} [opts]
 * @returns {Promise<ResolvedDisks>}
 */
export async function resolveProvisionDisks(opts = {}) {
  const env = opts.env || opts.provision?.env || 'dev'
  const target = opts.target || opts.provision?.target || 'local'
  const provision = opts.provision || (await loadEnvProvisionOrThrow({ env, target }))
  const modPath = await ensurePlatformModule({
    env,
    target,
    platform: provision.platform,
    quiet: true,
  })
  const platform = await platformDiskDefaultsFromModule(modPath)
  return resolveDisks(provision.data.disks, platform)
}
