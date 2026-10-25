/**
 * Init / new provision target stubs via the driver registry.
 *
 * Prefer Nunjucks `templates/provision/target-<id>.yaml.njk` when present;
 * otherwise {@link VmDriverModule.scaffoldTargetYaml}.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { provisionTargetFile } from '@qctl/shared'

import {
  defaultProvisionTemplateVars,
  loadScaffoldTemplate,
  scaffoldTemplatePath,
} from '../../templates.js'
import { getScaffoldTemplatesRoot } from '../../templates-root.js'
import { getDriverModule, listDriverIds } from './registry.js'

/** @import { VmDriverId } from '../driver-contract.js' */

/**
 * Registered driver ids (sorted), for target pickers / validation.
 * @returns {string[]}
 */
export function listScaffoldTargets() {
  return listDriverIds().map(String).sort()
}

/**
 * @param {string} target
 * @returns {boolean}
 */
export function isKnownScaffoldTarget(target) {
  const id = String(target ?? '').trim()
  if (!id) return false
  return getDriverModule(/** @type {VmDriverId} */ (id)) != null
}

/**
 * @param {string} target
 * @returns {string} Branded-looking id string after membership check
 */
export function assertScaffoldTarget(target) {
  const id = String(target ?? '').trim()
  if (!isKnownScaffoldTarget(id)) {
    const want = listScaffoldTargets().join('|') || '(none registered)'
    throw new Error(`invalid target '${target}' (want ${want})`)
  }
  return id
}

/**
 * Hint text for a target picker option.
 * @param {string} target
 * @returns {string | undefined}
 */
export function scaffoldHintFor(target) {
  const mod = getDriverModule(/** @type {VmDriverId} */ (String(target).trim()))
  return mod?.scaffoldHint
}

/**
 * Resolve stub YAML for `provision/target-<target>.yaml`.
 * @param {string} target
 * @returns {string}
 */
export function resolveTargetYamlStub(target) {
  const id = assertScaffoldTarget(target)
  const basename = provisionTargetFile(id)
  const templateRel = `provision/${basename}`
  const full = join(getScaffoldTemplatesRoot(), scaffoldTemplatePath(templateRel))
  if (existsSync(full)) {
    return loadScaffoldTemplate(templateRel, defaultProvisionTemplateVars())
  }
  const mod = getDriverModule(/** @type {VmDriverId} */ (id))
  if (typeof mod?.scaffoldTargetYaml === 'function') {
    const body = mod.scaffoldTargetYaml()
    return body.endsWith('\n') ? body : `${body}\n`
  }
  throw new Error(
    `no scaffold for target '${id}': add templates/${scaffoldTemplatePath(templateRel)} `
      + `or module.scaffoldTargetYaml`,
  )
}
