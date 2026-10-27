/**
 * Custom init — `qctl.environments` + shared-topology preference.
 */
import * as clack from '@clack/prompts'

import { asBindingPrompts } from '../../lib/binding.js'
import { validateLayerName } from './layer-name.js'
import { wizardScoped, wizardStep } from './ui.js'

/** @import { BindingPrompts } from '../../lib/binding.js' */

/**
 * @typedef {object} EnvironmentSpec
 * @property {boolean} production
 */

/**
 * @typedef {object} EnvironmentsAnswers
 * @property {Record<string, EnvironmentSpec>} environments
 * @property {boolean} shareTopology
 */

/**
 * @returns {EnvironmentsAnswers}
 */
export function defaultEnvironmentsAnswers() {
  return {
    environments: {
      dev: { production: false },
    },
    shareTopology: false,
  }
}

/**
 * @param {{ prompts?: BindingPrompts }} [opts]
 * @returns {Promise<EnvironmentsAnswers | symbol>}
 */
export async function promptEnvironments(opts = {}) {
  const p = asBindingPrompts(opts.prompts ?? clack)

  wizardStep(p, 'Environments')

  /** @type {Record<string, EnvironmentSpec>} */
  const environments = {}
  let addEnv = true
  let firstEnv = true
  while (addEnv) {
    const envName = await p.text({
      message: firstEnv ? 'Environment name' : 'Next environment name',
      initialValue: firstEnv ? 'dev' : '',
      validate: (/** @type {string | undefined} */ v) => {
        const err = validateLayerName(v)
        if (err) return err
        const key = String(v).trim()
        if (environments[key]) return `Environment ${key} already added`
        return undefined
      },
    })
    if (p.isCancel(envName)) return /** @type {symbol} */ (envName)
    const key = String(envName).trim()

    const production = await p.confirm({
      message: wizardScoped({ env: key }, 'Mark as production?'),
      initialValue: key === 'prod' || key === 'production',
    })
    if (p.isCancel(production)) return /** @type {symbol} */ (production)

    environments[key] = {
      production: Boolean(production),
    }
    firstEnv = false

    const more = await p.confirm({
      message: 'Add another environment?',
      initialValue: false,
    })
    if (p.isCancel(more)) return /** @type {symbol} */ (more)
    addEnv = Boolean(more)
  }

  const envKeys = Object.keys(environments)
  /** @type {boolean} */
  let shareTopology = false
  if (envKeys.length > 1) {
    const share = await p.confirm({
      message: 'Share networking across envs in common.yaml?',
      initialValue: true,
    })
    if (p.isCancel(share)) return /** @type {symbol} */ (share)
    shareTopology = Boolean(share)
  }

  return { environments, shareTopology }
}
