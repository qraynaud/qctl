/**
 * First-boot secrets baked at seed into Tier-0 (`LoadCredentialEncrypted` →
 * `$CREDENTIALS_DIRECTORY` / hydrated into `ctx.env`).
 */
import { hydrateSystemdCredentials } from '@qctl/shared'

/**
 * Active provision env: `QCTL_ENV`, else `dev`.
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function detectQctlEnv(env) {
  return env.QCTL_ENV?.trim() || 'dev'
}

/**
 * Ensure systemd credentials are visible on `env` (mutates).
 * @param {Record<string, string | undefined>} env
 */
export function hydrateStageEnv(env) {
  hydrateSystemdCredentials(env)
  return env
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} key
 * @returns {string}
 */
export function envString(env, key) {
  const v = env[key]
  if (v === undefined || v === null) return ''
  return String(v).trim()
}
