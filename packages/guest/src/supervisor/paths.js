/**
 * Runtime paths for qctl supervisor (sockets + app readiness stamps).
 * Override via opts in tests; production uses `/run/qctl`.
 */

export const QCTL_RUN_DIR_DEFAULT = '/run/qctl'

export const APPS_SOCK_NAME = 'apps.sock'
export const ADMIN_SOCK_NAME = 'admin.sock'

/**
 * @param {string} [runDir]
 * @returns {string}
 */
export function appsSockPath(runDir = QCTL_RUN_DIR_DEFAULT) {
  return `${runDir.replace(/\/+$/, '')}/${APPS_SOCK_NAME}`
}

/**
 * @param {string} [runDir]
 * @returns {string}
 */
export function adminSockPath(runDir = QCTL_RUN_DIR_DEFAULT) {
  return `${runDir.replace(/\/+$/, '')}/${ADMIN_SOCK_NAME}`
}

/**
 * @param {string} app
 * @param {string} [runDir]
 * @returns {string}
 */
export function appStampDir(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  return `${runDir.replace(/\/+$/, '')}/app/${app}`
}

/**
 * @param {string} app
 * @param {string} [runDir]
 * @returns {string}
 */
export function appReadyPath(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  return `${appStampDir(app, runDir)}/ready`
}

/**
 * @param {string} app
 * @param {string} [runDir]
 * @returns {string}
 */
export function appFailedPath(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  return `${appStampDir(app, runDir)}/failed`
}
