/**
 * Custom init — `qctl.profiles` + `default-profile`.
 */
import * as clack from '@clack/prompts'

import { asBindingPrompts } from '../../lib/binding.js'
import '../../vm/drivers/index.js'
import { listScaffoldTargets, scaffoldHintFor } from '../../vm/drivers/scaffold.js'
import { validateLayerName } from './layer-name.js'
import { wizardScoped, wizardStep } from './ui.js'

/** @import { BindingPrompts } from '../../lib/binding.js' */
/** @import { ProfileWriteSpec } from '../write-provision.js' */
/** @import { EnvironmentSpec } from './environments.js' */

/** Select value → omit default (`default-profile: null`). */
const NO_DEFAULT_PROFILE = '__none__'

/**
 * @typedef {object} ProfilesAnswers
 * @property {Record<string, ProfileWriteSpec>} profiles
 * @property {string | null} [defaultProfile]
 *   Asked only when ≥2 profiles: key, or `null` → `default-profile: null` (require `-p`).
 *   Omitted with a single profile → loader uses that profile as default.
 */

/**
 * @returns {ProfilesAnswers}
 */
export function defaultProfilesAnswers() {
  return {
    profiles: {
      lab: { env: 'dev', target: 'workstation' },
    },
  }
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   envKeys: string[]
 *   environments: Record<string, EnvironmentSpec>
 * }} opts
 * @returns {Promise<ProfilesAnswers | symbol>}
 */
export async function promptProfiles(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const { envKeys, environments } = opts

  wizardStep(p, 'Profiles')

  /** @type {Record<string, ProfileWriteSpec>} */
  const profiles = {}
  let addProfile = true
  let firstProfile = true
  while (addProfile) {
    const profileName = await p.text({
      message: firstProfile ? 'Profile name' : 'Next profile name',
      initialValue: firstProfile ? 'lab' : '',
      validate: (/** @type {string | undefined} */ v) => {
        const err = validateLayerName(v)
        if (err) return err
        const key = String(v).trim()
        if (profiles[key]) return `Profile ${key} already added`
        return undefined
      },
    })
    if (p.isCancel(profileName)) return /** @type {symbol} */ (profileName)
    const pKey = String(profileName).trim()

    const env = await p.select({
      message: wizardScoped({ profile: pKey }, 'Environment'),
      options: envKeys.map((k) => ({
        value: k,
        label: k,
        hint: environments[k]?.production ? 'production' : undefined,
      })),
      initialValue: envKeys[0],
    })
    if (p.isCancel(env)) return /** @type {symbol} */ (env)

    const targets = listScaffoldTargets()
    const target = await p.select({
      message: wizardScoped({ profile: pKey }, 'Target'),
      options: targets.map((t) => ({
        value: t,
        label: t,
        hint: scaffoldHintFor(t),
      })),
      initialValue: targets.includes('workstation') ? 'workstation' : targets[0],
    })
    if (p.isCancel(target)) return /** @type {symbol} */ (target)

    profiles[pKey] = {
      env: String(env),
      target: String(target),
    }
    firstProfile = false

    const more = await p.confirm({
      message: 'Add another profile?',
      initialValue: false,
    })
    if (p.isCancel(more)) return /** @type {symbol} */ (more)
    addProfile = Boolean(more)
  }

  const profileKeys = Object.keys(profiles)
  if (profileKeys.length < 2) {
    return { profiles }
  }

  const picked = await p.select({
    message: 'Default profile',
    options: [
      ...profileKeys.map((k) => ({
        value: k,
        label: k,
        hint: `${profiles[k]?.env} / ${profiles[k]?.target}`,
      })),
      {
        value: NO_DEFAULT_PROFILE,
        label: 'None',
        hint: 'require -p on every command',
      },
    ],
    initialValue: profileKeys[0],
  })
  if (p.isCancel(picked)) return /** @type {symbol} */ (picked)
  /** @type {string | null} */
  const defaultProfile = picked === NO_DEFAULT_PROFILE ? null : String(picked)

  return { profiles, defaultProfile }
}
