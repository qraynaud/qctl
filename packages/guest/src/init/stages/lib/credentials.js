/** @import { StageContext } from '../../context.js' */

/**
 * First-boot secrets from ISO `qctl-seed/tier0` / `$CREDENTIALS_DIRECTORY`
 * → {@link StageContext.secrets}.
 */

/**
 * Active provision env label from OS config (default `dev`).
 * @param {{ env?: string } | undefined} osConfig
 * @returns {string}
 */
export function detectQctlEnv(osConfig) {
  return osConfig?.env?.trim() || 'dev'
}

/**
 * @param {Record<string, string>} secrets
 * @param {string} key
 * @returns {string}
 */
export function secretString(secrets, key) {
  const v = secrets[key]
  if (v === undefined || v === null) return ''
  return String(v).trim()
}
