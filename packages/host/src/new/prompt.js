/**
 * Interactive / `--yes` option resolution for `qctl new app|common|network|unit`.
 */
import * as clack from '@clack/prompts'

import { isInteractiveTty } from '../init/quickstart.js'
import { asBindingPrompts } from '../lib/binding.js'
import { listAppsForNewUnit, newUnit } from '../new.js'

/** @import { BindingPrompts } from '../lib/binding.js' */
/** @import { AppEngine, UnitContainerKind } from '../new.js' */

/**
 * @typedef {BindingPrompts & {
 *   intro?: typeof clack.intro
 *   outro?: typeof clack.outro
 *   log?: typeof clack.log
 * }} NewPrompts
 */

const PACKAGE_NAME_RE = /^[a-z][a-z0-9-]*$/

/**
 * @param {{ prompts?: NewPrompts }} [opts]
 */
export function canPrompt(opts = {}) {
  return opts.prompts != null || isInteractiveTty()
}

/**
 * @param {string} name
 * @param {string} [label]
 */
export function assertPackageName(name, label = 'name') {
  if (!PACKAGE_NAME_RE.test(name)) {
    throw new Error(
      `invalid ${label} '${name}': use lowercase letters, digits, and hyphens (must start with a letter)`,
    )
  }
}

/**
 * Resolve a package/unit positional: CLI value, else TTY prompt, else fail.
 * @param {string | undefined} raw
 * @param {{
 *   label: string
 *   message: string
 *   yes?: boolean
 *   placeholder?: string
 *   initialValue?: string
 *   prompts?: NewPrompts
 * }} opts
 * @returns {Promise<string>}
 */
export async function resolvePackageName(raw, opts) {
  const trimmed = raw != null ? String(raw).trim() : ''
  if (trimmed) {
    assertPackageName(trimmed, opts.label)
    return trimmed
  }

  const initial = opts.initialValue?.trim() || ''

  if (opts.yes || !canPrompt(opts)) {
    if (initial) {
      assertPackageName(initial, opts.label)
      return initial
    }
    throw new Error(
      `${opts.label} required (pass a positional argument, or run on a TTY without --yes)`,
    )
  }

  const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
  const answered = await p.text({
    message: opts.message,
    placeholder: opts.placeholder ?? (initial || undefined),
    initialValue: initial || undefined,
    validate: (v) => {
      const s = String(v ?? '').trim()
      if (!s) return `${opts.label} required`
      if (!PACKAGE_NAME_RE.test(s)) {
        return 'lowercase letters, digits, hyphens (must start with a letter)'
      }
      return undefined
    },
  })
  if (p.isCancel(answered)) {
    p.cancel?.('Cancelled')
    throw new Error('cancelled')
  }
  const name = String(answered).trim()
  assertPackageName(name, opts.label)
  return name
}

/**
 * @typedef {object} NewAppFlags
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {string} [engine] rootless | rootful (CLI string)
 * @property {boolean} [empty]
 * @property {string} [unit]
 */

/**
 * @typedef {object} NewAppResolved
 * @property {string} name
 * @property {boolean} force
 * @property {boolean} yes
 * @property {AppEngine | null} engine
 * @property {boolean} empty
 * @property {string | undefined} unit
 */

/**
 * @param {string | undefined} raw
 * @returns {AppEngine | null}
 */
export function parseEngineFlag(raw) {
  if (raw == null || raw === '') return null
  const e = String(raw).trim()
  if (e === 'rootless' || e === 'rootful') return e
  throw new Error(`invalid --engine '${raw}' (want rootless|rootful)`)
}

/**
 * Resolve app scaffolding options (flags + optional TTY prompts).
 * @param {NewAppFlags} flags
 * @param {{ prompts?: NewPrompts }} [opts]
 * @returns {Promise<NewAppResolved>}
 */
export async function resolveNewAppOptions(flags, opts = {}) {
  const force = Boolean(flags.force)
  const yes = Boolean(flags.yes)
  const emptyFlag = Boolean(flags.empty)
  const unitFlag = flags.unit?.trim() || undefined
  if (unitFlag) assertPackageName(unitFlag, '--unit')

  const name = await resolvePackageName(flags.name, {
    label: 'name',
    message: 'App name',
    placeholder: 'demo',
    yes,
    prompts: opts.prompts,
  })

  let engine = parseEngineFlag(flags.engine)

  if (engine == null && !emptyFlag) {
    if (yes) {
      engine = 'rootless'
    } else if (canPrompt(opts)) {
      const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
      const picked = await p.select({
        message: 'Podman engine for app.yaml',
        options: [
          { value: 'rootless', label: 'rootless (default)' },
          { value: 'rootful', label: 'rootful' },
          { value: 'skip', label: 'Skip app.yaml (schema/README only)' },
        ],
        initialValue: 'rootless',
      })
      if (p.isCancel(picked)) {
        p.cancel?.('Cancelled')
        throw new Error('cancelled')
      }
      engine = picked === 'skip' ? null : /** @type {AppEngine} */ (picked)
    }
  }

  return {
    name,
    force,
    yes,
    engine,
    empty: emptyFlag,
    unit: emptyFlag ? undefined : unitFlag,
  }
}

/**
 * After `newPackage('app', …)`, run {@link resolveNewUnitOptions} / {@link newUnit}
 * for the first unit (name defaults to the app name) and loop for more on TTY.
 * @param {string} appName
 * @param {NewAppResolved} appOpts
 * @param {{ cwd?: string, prompts?: NewPrompts }} [opts]
 * @returns {Promise<string[]>} relative paths written under the app
 */
export async function scaffoldAppUnits(appName, appOpts, opts = {}) {
  /** @type {string[]} */
  const written = []
  if (!appOpts.engine || appOpts.empty) return written

  const firstOpts = await resolveNewUnitOptions(
    {
      app: appName,
      name: appOpts.unit,
      yes: appOpts.yes,
      force: appOpts.force,
      envStub: false,
    },
    {
      cwd: opts.cwd,
      prompts: opts.prompts,
      skipAppPrompt: true,
      defaultContainer: 'demo',
      nameInitial: appName,
    },
  )
  const first = newUnit(firstOpts.app, firstOpts.name, {
    cwd: opts.cwd,
    force: firstOpts.force,
    container: firstOpts.container,
    envStub: firstOpts.envStub,
  })
  written.push(...first.extra)

  if (appOpts.yes || !canPrompt(opts)) return written

  const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
  while (true) {
    const more = await p.confirm({
      message: 'Add another unit?',
      initialValue: false,
    })
    if (p.isCancel(more)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    if (!more) break

    const unitOpts = await resolveNewUnitOptions(
      { app: appName, yes: false, force: appOpts.force },
      { cwd: opts.cwd, prompts: opts.prompts, skipAppPrompt: true, defaultContainer: 'stub' },
    )
    const next = newUnit(unitOpts.app, unitOpts.name, {
      cwd: opts.cwd,
      force: unitOpts.force,
      container: unitOpts.container,
      envStub: unitOpts.envStub,
    })
    written.push(...next.extra)
  }

  return written
}

/**
 * Resolve common/network package name (positional or prompt).
 * @param {{ name?: string, yes?: boolean, force?: boolean }} flags
 * @param {{ kind: 'common' | 'network', prompts?: NewPrompts }} opts
 * @returns {Promise<{ name: string, force: boolean }>}
 */
export async function resolveNewNamedPackageOptions(flags, opts) {
  const label = opts.kind === 'network' ? 'network name' : 'common package name'
  const name = await resolvePackageName(flags.name, {
    label: 'name',
    message: label.charAt(0).toUpperCase() + label.slice(1),
    placeholder: opts.kind === 'network' ? 'vlan2' : 'lib-x',
    yes: Boolean(flags.yes),
    prompts: opts.prompts,
  })
  return { name, force: Boolean(flags.force) }
}

/**
 * @typedef {object} NewUnitFlags
 * @property {string} [app]
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {boolean} [empty]
 * @property {boolean} [envStub]
 */

/**
 * @typedef {object} NewUnitResolved
 * @property {string} app
 * @property {string} name
 * @property {boolean} force
 * @property {UnitContainerKind} container
 * @property {boolean} envStub
 */

/**
 * @param {NewUnitFlags} flags
 * @param {{
 *   cwd?: string
 *   prompts?: NewPrompts
 *   skipAppPrompt?: boolean
 *   defaultContainer?: UnitContainerKind
 *   nameInitial?: string
 * }} [opts]
 * @returns {Promise<NewUnitResolved>}
 */
export async function resolveNewUnitOptions(flags, opts = {}) {
  const force = Boolean(flags.force)
  const yes = Boolean(flags.yes)
  const empty = Boolean(flags.empty)
  let envStub = Boolean(flags.envStub)

  let app = flags.app != null ? String(flags.app).trim() : ''
  if (app) {
    assertPackageName(app, 'app')
  } else if (opts.skipAppPrompt) {
    throw new Error('app required')
  } else if (yes || !canPrompt(opts)) {
    throw new Error('app required (pass a positional argument, or run on a TTY without --yes)')
  } else {
    const apps = listAppsForNewUnit(opts.cwd)
    if (apps.length === 0) {
      throw new Error('no applications with app.yaml — run `qctl new app` first')
    }
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const picked = await p.select({
      message: 'App',
      options: apps.map((a) => ({ value: a, label: a })),
      initialValue: apps[0],
    })
    if (p.isCancel(picked)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    app = String(picked)
  }

  const nameDefault = opts.nameInitial?.trim() || app
  const name = await resolvePackageName(flags.name, {
    label: 'name',
    message: 'Unit name',
    placeholder: nameDefault,
    initialValue: nameDefault,
    yes,
    prompts: opts.prompts,
  })

  /** @type {UnitContainerKind} */
  let container = empty ? 'none' : (opts.defaultContainer ?? 'stub')
  if (!empty && !yes && canPrompt(opts) && opts.defaultContainer === undefined) {
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const want = await p.confirm({
      message: 'Include commented .container stub?',
      initialValue: true,
    })
    if (p.isCancel(want)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    container = want ? 'stub' : 'none'
  }

  if (!yes && canPrompt(opts) && flags.envStub == null) {
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const wantEnv = await p.confirm({
      message: 'Include empty .env.dev stub?',
      initialValue: false,
    })
    if (p.isCancel(wantEnv)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    envStub = Boolean(wantEnv)
  }

  return { app, name, force, container, envStub }
}
