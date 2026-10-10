/**
 * Content hash for Podman secret labels (`qctl.sha256`) — compare without reading secret bytes.
 */
import { createHash } from 'node:crypto'

/** Podman secret label key written by `qctl secret sync`. */
export const SECRET_HASH_LABEL = 'qctl.sha256'

/**
 * @param {string} value
 * @returns {string} hex sha256
 */
export function secretContentHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
