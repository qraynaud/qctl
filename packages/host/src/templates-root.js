/**
 * Instance scaffold templates for `qctl init` / `qctl new`.
 * Owned by `@qctl/host` as `packages/host/templates`; compiled `qctl-host` embeds
 * it via `bun build --asset templates`.
 *
 * Resolution order:
 *   1. `QCTL_SCAFFOLD_TEMPLATES` (tests / overrides)
 *   2. Workspace `packages/host/templates` (`bun run`)
 *   3. Bun `--asset templates` embed (`import.meta.dir/templates` inside compiled `qctl-host`)
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Workspace checkout: packages/host/templates next to this module's package root.
 * @returns {string}
 */
export function workspaceTemplatesRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
}

/**
 * Scaffold templates embedded into the compiled `qctl-host` via `bun build --asset templates`.
 * @returns {string}
 */
export function embeddedTemplatesRoot() {
  return join(import.meta.dir, 'templates')
}

/**
 * @param {string} root
 * @returns {boolean}
 */
export function isTemplatesRoot(root) {
  return Boolean(root && existsSync(join(root, 'provision', 'common.yaml.njk')))
}

/**
 * Effective scaffold templates root for the current process (may be a `$bunfs` path when compiled).
 * @returns {string}
 */
export function getScaffoldTemplatesRoot() {
  const fromEnv = process.env.QCTL_SCAFFOLD_TEMPLATES
  if (fromEnv && isTemplatesRoot(fromEnv)) return fromEnv

  const workspace = workspaceTemplatesRoot()
  if (isTemplatesRoot(workspace)) return workspace

  const embedded = embeddedTemplatesRoot()
  if (isTemplatesRoot(embedded)) return embedded

  throw new Error(
    'Scaffold templates not found (provision/common.yaml.njk).\n'
      + '  Set QCTL_SCAFFOLD_TEMPLATES, use a workspace checkout with packages/host/templates,'
      + ' or a qctl-host binary compiled with the templates asset.',
  )
}
