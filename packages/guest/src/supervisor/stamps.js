/**
 * App readiness stamps under `/run/qctl/app/<app>/`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

import { QCTL_RUN_DIR_DEFAULT, appReadyPath, appStampDir } from './paths.js'

/**
 * Ensure the supervisor runtime directory exists (mode 0755).
 * @param {string} [runDir]
 */
export function ensureRunDir(runDir = QCTL_RUN_DIR_DEFAULT) {
  mkdirSync(runDir, { recursive: true, mode: 0o755 })
}

/**
 * Mark app ready (world-readable so apps user can watch).
 * @param {string} app
 * @param {string} [runDir]
 */
export function setAppReady(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  const dir = appStampDir(app, runDir)
  mkdirSync(dir, { recursive: true, mode: 0o755 })
  writeFileSync(appReadyPath(app, runDir), `${Date.now()}\n`, { encoding: 'utf8', mode: 0o644 })
}

/**
 * Clear ready stamp (and stamp dir if empty enough — just remove ready file).
 * @param {string} app
 * @param {string} [runDir]
 */
export function clearAppReady(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  const p = appReadyPath(app, runDir)
  rmSync(p, { force: true })
}

/**
 * @param {string} app
 * @param {string} [runDir]
 * @returns {boolean}
 */
export function isAppReady(app, runDir = QCTL_RUN_DIR_DEFAULT) {
  return existsSync(appReadyPath(app, runDir))
}
