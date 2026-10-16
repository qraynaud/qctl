/**
 * Discover `@sensitive` schema items through the varlock **graph API** (`@qctl/shared`
 * `loadEnvGraphForDir`) — never the `varlock` CLI.
 *
 * Default Podman store follows the package `app.yaml` `engine:` (see
 * `schemaDirIsRootful`). `# @tag(cross-engine)` writes the secret to both stores
 * so rootless and rootful apps can share it.
 */
import { keysWithTag, loadEnvGraphForDir, resolvedSensitive } from '@qctl/shared'

/** @typedef {'rootless' | 'rootful'} Engine */

/**
 * @typedef {object} SensitiveItem
 * @property {string} key
 * @property {string} value
 * @property {Engine[]} engines  Podman stores to create/update
 */

/** Secret is useful to apps on both engines → both Podman stores. */
export const CROSS_ENGINE_TAG = 'cross-engine'

/**
 * @param {boolean} packageRootful  from `app.yaml` `engine: rootful`
 * @param {boolean} crossEngine     `# @tag(cross-engine)`
 * @returns {Engine[]}
 */
export function enginesForSecret(packageRootful, crossEngine) {
  if (crossEngine) return ['rootless', 'rootful']
  return packageRootful ? ['rootful'] : ['rootless']
}

/**
 * Sensitive items declared in `<dir>/.env.schema` (sorted by key).
 *
 * @param {string} dir
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   qctlEnv?: string,
 *   rootful?: boolean,
 * }} [opts] `qctlEnv` is exported as `QCTL_ENV` for schema `@import(..., enabled=…)`.
 *   `rootful` defaults to false (caller sets from `app.yaml` engine).
 * @returns {Promise<SensitiveItem[]>}
 */
export async function loadSensitiveItems(dir, opts = {}) {
  const graph = await loadEnvGraphForDir(dir, {
    env: opts.env,
    qctlEnv: opts.qctlEnv,
    frozen: true,
  })
  const packageRootful = opts.rootful === true
  const cross = keysWithTag(graph, CROSS_ENGINE_TAG)
  return resolvedSensitive(graph).map(({ key, value }) => ({
    key,
    value,
    engines: enginesForSecret(packageRootful, cross.has(key)),
  }))
}
