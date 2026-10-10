/**
 * Dynamically import the staged platform ESM module (not a package dependency).
 */
import { definePlatform } from '@qctl/shared'

import { platformModuleImportUrl, resolvePlatformModule } from './platform.js'

/** @import { PlatformModule } from '@qctl/shared' */

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<PlatformModule>}
 */
export async function loadPlatformModule(env = process.env) {
  const abs = resolvePlatformModule({ env })
  const mod = await import(platformModuleImportUrl(abs))
  const raw = mod.platform ?? mod.default ?? mod
  return definePlatform(raw)
}
