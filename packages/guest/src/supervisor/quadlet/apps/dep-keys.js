/**
 * Shared systemd dependency-line keys and service-token parsing (no filesystem).
 */

/** systemd dependency keys scanned/rewritten for cross-app peers. */
export const UNIT_DEP_KEYS = Object.freeze([
  'After',
  'Wants',
  'Requires',
  'Requisite',
  'BindsTo',
  'PartOf',
  'Upholds',
  'PropagatesStopTo',
  'StopPropagatedFrom',
])

export const DEP_LINE_RE = new RegExp(`^(${UNIT_DEP_KEYS.join('|')})=(.*)$`)

/**
 * Map a `.service` token to an app name, or null if not a service unit.
 * Accepts both `web.service` and `qctl-app@web.service`.
 * @param {string} unit
 * @returns {string | null}
 */
export function serviceTokenToApp(unit) {
  if (!unit.endsWith('.service')) return null
  const proxy = /^qctl-app@(.+)\.service$/.exec(unit)
  if (proxy) return proxy[1]
  return unit.slice(0, -'.service'.length)
}

/**
 * @param {string} app
 * @returns {string}
 */
export function qctlAppProxyUnit(app) {
  return `qctl-app@${app}.service`
}
