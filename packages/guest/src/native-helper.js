/**
 * Embedded `varlock-local-encrypt` from `bun build --asset` (compiled guest).
 */
import { join } from 'node:path'

import { configureNativeHelperEmbed, ensureVarlockLocalEncrypt } from '@qctl/shared'

/**
 * @returns {string}
 */
export function embeddedNativeHelperPath() {
  return join(import.meta.dir, 'varlock-local-encrypt')
}

/**
 * @returns {Promise<string | null>}
 */
export async function ensureGuestNativeHelper() {
  const sea = embeddedNativeHelperPath()
  configureNativeHelperEmbed(sea)
  return await ensureVarlockLocalEncrypt({ embedPath: sea })
}
