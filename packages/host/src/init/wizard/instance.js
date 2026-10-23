/**
 * Custom init — instance basics: name, timezone, platform.
 */
import { basename } from 'node:path'

import * as clack from '@clack/prompts'

import { asBindingPrompts } from '../../lib/binding.js'
import { wizardStep } from './ui.js'

/** @import { BindingPrompts } from '../../lib/binding.js' */

/**
 * @typedef {object} InstanceAnswers
 * @property {string} name package.json name
 * @property {string} platform qctl.platform
 * @property {string} tz Root TZ for every .env.<env>
 */

/**
 * Host IANA timezone for TZ defaults (e.g. Europe/Paris), or UTC if unknown.
 * @returns {string}
 */
export function hostTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && String(tz).trim() ? String(tz).trim() : 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * @param {string} root Absolute instance root
 * @param {{ initialName?: string }} [opts]
 * @returns {InstanceAnswers}
 */
export function defaultInstanceAnswers(root, opts = {}) {
  return {
    name: opts.initialName ?? basename(root),
    platform: 'rocky',
    tz: hostTimezone(),
  }
}

/**
 * @param {string} root
 * @param {{
 *   prompts?: BindingPrompts
 *   initialName?: string
 * }} [opts]
 * @returns {Promise<InstanceAnswers | symbol>}
 */
export async function promptInstance(root, opts = {}) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const defaults = defaultInstanceAnswers(root, { initialName: opts.initialName })

  wizardStep(p, 'Instance — name, timezone, platform')

  const name = await p.text({
    message: 'Instance name (package.json)',
    initialValue: opts.initialName ?? defaults.name,
    validate: (/** @type {string | undefined} */ v) =>
      v && String(v).trim() ? undefined : 'Name required',
  })
  if (p.isCancel(name)) return /** @type {symbol} */ (name)

  const tz = await p.text({
    message: 'Timezone (TZ in root .env.*)',
    initialValue: defaults.tz,
    validate: (/** @type {string | undefined} */ v) =>
      v && String(v).trim() ? undefined : 'TZ required',
  })
  if (p.isCancel(tz)) return /** @type {symbol} */ (tz)

  const platformChoice = await p.select({
    message: 'Guest platform (qctl.platform)',
    options: [
      { value: 'rocky', label: 'rocky (default)', hint: '@qctl/platform-rocky' },
      { value: 'other', label: 'Other / plugin ref', hint: 'github:org/repo[@ver]' },
    ],
    initialValue: 'rocky',
  })
  if (p.isCancel(platformChoice)) return /** @type {symbol} */ (platformChoice)

  /** @type {string} */
  let platform = 'rocky'
  if (platformChoice === 'other') {
    const custom = await p.text({
      message: 'Platform plugin id',
      placeholder: 'github:owner/platform-foo',
      validate: (/** @type {string | undefined} */ v) =>
        v && String(v).trim() ? undefined : 'Platform required',
    })
    if (p.isCancel(custom)) return /** @type {symbol} */ (custom)
    platform = String(custom).trim()
  }

  return {
    name: String(name).trim(),
    platform,
    tz: String(tz).trim(),
  }
}
