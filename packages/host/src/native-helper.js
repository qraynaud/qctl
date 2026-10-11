/**
 * Embedded `varlock-local-encrypt` from `bun build --asset` (compiled host)
 * or workspace staging path during compile.
 *
 * Note: Bun `$bunfs` may report the asset via `existsSync` while `copyFileSync`
 * fails — shared materialize uses read/write and falls back to a real sibling /
 * npm helper when the embed is a hole.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { configureNativeHelperEmbed, ensureVarlockLocalEncrypt } from '@qctl/shared'

/**
 * SEA embed path (`bun --asset varlock-local-encrypt`, same layout as `seed/`).
 * @returns {string}
 */
export function embeddedNativeHelperPath() {
  return join(import.meta.dir, 'varlock-local-encrypt')
}

/**
 * Workspace path used by `ci/compile.js` before `--asset` embed.
 * @returns {string}
 */
export function workspaceNativeHelperPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'varlock-local-encrypt')
}

/**
 * Configure embed path and materialize SEA sibling when running as compiled qctl.
 * @returns {Promise<string | null>}
 */
export async function ensureHostNativeHelper() {
  // Prefer SEA path when compiled; shared layer validates readability.
  const sea = embeddedNativeHelperPath()
  const workspace = workspaceNativeHelperPath()
  configureNativeHelperEmbed(sea || workspace)
  return await ensureVarlockLocalEncrypt({ embedPath: sea })
}
