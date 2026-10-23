/**
 * Popular varlock `# @plugin` packages offered during Custom init (project step).
 */
import * as clack from '@clack/prompts'

import { asBindingPrompts } from '../../lib/binding.js'
import { wizardStep } from './ui.js'

/** @import { BindingPrompts, MultiselectPromptOpts } from '../../lib/binding.js' */

/** Sentinal multiselect value → prompt for a free-form npm package. */
export const CUSTOM_VARLOCK_PLUGIN = '__custom__'

/** Pinned range for the qctl Vaultwarden plugin. */
export const VAULTWARDEN_PLUGIN = '@qctl/vaultwarden-plugin'
export const VAULTWARDEN_PLUGIN_RANGE = '^0.1.5'

/**
 * @typedef {object} PopularVarlockPlugin
 * @property {string} package npm package name
 * @property {string} range Semver range for package.json
 * @property {string} label Clack option label
 * @property {string} [hint] Clack option hint
 */

/**
 * @typedef {object} VarlockPluginDep
 * @property {string} package
 * @property {string} range
 */

/** @type {readonly PopularVarlockPlugin[]} */
export const POPULAR_VARLOCK_PLUGINS = Object.freeze([
  {
    package: VAULTWARDEN_PLUGIN,
    range: VAULTWARDEN_PLUGIN_RANGE,
    label: 'Vaultwarden (qctl)',
    hint: 'vw() + attachments',
  },
  {
    package: '@varlock/1password-plugin',
    range: '*',
    label: '1Password',
    hint: 'op()',
  },
  {
    package: '@varlock/bitwarden-plugin',
    range: '*',
    label: 'Bitwarden (official)',
    hint: 'bitwarden() / bwp()',
  },
  {
    package: '@varlock/doppler-plugin',
    range: '*',
    label: 'Doppler',
    hint: 'doppler()',
  },
  {
    package: '@varlock/infisical-plugin',
    range: '*',
    label: 'Infisical',
    hint: 'infisical()',
  },
])

/** @type {ReadonlyMap<string, PopularVarlockPlugin>} */
const BY_PACKAGE = new Map(POPULAR_VARLOCK_PLUGINS.map((p) => [p.package, p]))

/**
 * Loose npm package name check (`name` or `@scope/name`).
 * @param {string | undefined | null} name
 * @returns {string | undefined} Error, or undefined if ok
 */
export function validateNpmPackageName(name) {
  const n = String(name ?? '').trim()
  if (!n) return 'Package name required'
  if (n === CUSTOM_VARLOCK_PLUGIN) return 'Invalid package name'
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(n)) {
    return 'Expected npm package name (e.g. @scope/pkg or pkg)'
  }
  return undefined
}

/**
 * @param {VarlockPluginDep[]} plugins
 * @returns {Record<string, string>}
 */
export function varlockPluginsToDependencies(plugins) {
  /** @type {Record<string, string>} */
  const deps = {}
  for (const p of plugins) deps[p.package] = p.range
  return deps
}

/**
 * Commented `# @plugin` (and VW `@initVw`) hints for production root env files.
 * @param {VarlockPluginDep[]} plugins
 * @returns {string}
 */
export function varlockPluginHintBlock(plugins) {
  if (plugins.length === 0) return ''
  /** @type {string[]} */
  const lines = []
  for (const p of plugins) {
    lines.push(`#   # @plugin(${p.package})`)
    if (p.package === VAULTWARDEN_PLUGIN) {
      lines.push(
        '#   # @initVw(appDataDir=/vw, clientId=$VW_CLIENT_ID, clientSecret=$VW_CLIENT_SECRET, '
          + 'masterPassword=$VW_MASTER_PASSWORD, cacheTtl=5m)',
      )
    }
  }
  return lines.join('\n')
}

/**
 * Confirm whether plugins are needed, then multiselect popular + optional custom.
 * @param {{ prompts?: BindingPrompts }} [opts]
 * @returns {Promise<VarlockPluginDep[] | symbol>}
 */
export async function promptVarlockPlugins(opts = {}) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  /** @type {(opts: MultiselectPromptOpts) => Promise<string[] | symbol>} */
  const multi =
    p.multiselect
    ?? /** @type {(opts: MultiselectPromptOpts) => Promise<string[] | symbol>} */ (
      /** @type {never} */ (clack.multiselect)
    )

  wizardStep(p, 'Varlock plugins')

  const needPlugins = await p.confirm({
    message: 'Add varlock plugins for secrets (1Password, Vaultwarden, …)?',
    initialValue: false,
  })
  if (p.isCancel(needPlugins)) return /** @type {symbol} */ (needPlugins)
  if (!needPlugins) return []

  const picked = await multi({
    message: 'Which varlock plugins?',
    options: [
      ...POPULAR_VARLOCK_PLUGINS.map((plug) => ({
        value: plug.package,
        label: plug.label,
        hint: plug.hint,
      })),
      {
        value: CUSTOM_VARLOCK_PLUGIN,
        label: 'Custom package…',
        hint: 'type any npm plugin name',
      },
    ],
    required: true,
  })
  if (p.isCancel(picked)) return /** @type {symbol} */ (picked)

  const values = Array.isArray(picked) ? picked.map(String) : []
  /** @type {VarlockPluginDep[]} */
  const plugins = []
  /** @type {Set<string>} */
  const seen = new Set()

  for (const id of values) {
    if (id === CUSTOM_VARLOCK_PLUGIN) continue
    if (seen.has(id)) continue
    const known = BY_PACKAGE.get(id)
    if (known) {
      plugins.push({ package: known.package, range: known.range })
      seen.add(known.package)
    }
  }

  if (values.includes(CUSTOM_VARLOCK_PLUGIN)) {
    let addMore = true
    while (addMore) {
      const name = await p.text({
        message: 'Custom varlock plugin package',
        placeholder: '@scope/my-plugin',
        validate: (/** @type {string | undefined} */ v) => {
          const err = validateNpmPackageName(v)
          if (err) return err
          const key = String(v).trim()
          if (seen.has(key)) return `${key} already selected`
          return undefined
        },
      })
      if (p.isCancel(name)) return /** @type {symbol} */ (name)
      const pkg = String(name).trim()

      const range = await p.text({
        message: `Version range for ${pkg}`,
        initialValue: '*',
        validate: (/** @type {string | undefined} */ v) =>
          v && String(v).trim() ? undefined : 'Range required',
      })
      if (p.isCancel(range)) return /** @type {symbol} */ (range)

      plugins.push({ package: pkg, range: String(range).trim() })
      seen.add(pkg)

      const more = await p.confirm({
        message: 'Add another custom plugin?',
        initialValue: false,
      })
      if (p.isCancel(more)) return /** @type {symbol} */ (more)
      addMore = Boolean(more)
    }
  }

  return plugins
}
