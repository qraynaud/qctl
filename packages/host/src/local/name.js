import { createHash, randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * Stable Podman name for one instance root: `qctl-local-<folder>-<hash>`.
 * @param {string} instanceRoot
 * @returns {string}
 */
export function localContainerName(instanceRoot) {
  const abs = realpathSync(instanceRoot)
  const raw = basename(abs)
  const folder =
    raw
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'instance'
  const hash = createHash('sha256').update(abs).digest('hex').slice(0, 8)
  return `qctl-local-${folder}-${hash}`
}

/**
 * Disposable name for `qctl local test`: `<stable>-test-<id>`.
 * Concurrent tests (and `local up` labs) do not share an appliance.
 * @param {string} instanceRoot
 * @param {string} [id] override random id (tests)
 * @returns {string}
 */
export function localTestContainerName(instanceRoot, id = randomBytes(4).toString('hex')) {
  const safe = String(id)
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 12)
  const suffix = safe || randomBytes(4).toString('hex')
  // Podman name max ~63; keep stable prefix + short test id.
  const base = localContainerName(instanceRoot).slice(0, 48)
  return `${base}-test-${suffix}`
}
