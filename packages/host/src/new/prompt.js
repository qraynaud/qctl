/**
 * Interactive / `--yes` option resolution for `qctl new app|common|network|unit|env|profile`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { PROVISION_TARGETS, provisionEnvFile, provisionTargetFile } from '@qctl/shared'

import { isInteractiveTty } from '../init/quickstart.js'
import {
  applyOverlaysAnswers,
  defaultProxmoxOverlay,
  defaultWorkstationOverlay,
  promptOverlays,
} from '../init/wizard/overlays.js'
import { asBindingPrompts } from '../lib/binding.js'
import { listAppsForNewUnit, newUnit, requireInstanceRoot } from '../new.js'
import {
  listEnvYamlNames,
  listEnvironmentKeys,
  listProvisionTargets,
  newEnv,
  newProfile,
  targetLayerExists,
} from './provision.js'

/** @import { NetworkingTopology } from '../init/wizard/networking.js' */
/** @import { OverlaysWizardAnswers } from '../init/wizard/overlays.js' */
/** @import { BindingPrompts } from '../lib/binding.js' */
/** @import { AppEngine, UnitContainerKind } from '../new.js' */
/** @import { NewProfileResult } from './provision.js' */

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

/**
 * @typedef {object} NewEnvFlags
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {boolean} [production]
 * @property {string} [from]
 * @property {boolean} [syncEnvFromYaml]
 */

/**
 * @typedef {object} NewEnvResolved
 * @property {string} name
 * @property {boolean} force
 * @property {boolean} production
 * @property {string | undefined} from
 * @property {boolean} syncEnvFromYaml
 */

/**
 * @param {NewEnvFlags} flags
 * @param {{ cwd?: string, prompts?: NewPrompts }} [opts]
 * @returns {Promise<NewEnvResolved>}
 */
export async function resolveNewEnvOptions(flags, opts = {}) {
  const force = Boolean(flags.force)
  const yes = Boolean(flags.yes)

  const name = await resolvePackageName(flags.name, {
    label: 'name',
    message: 'Environment name',
    placeholder: 'staging',
    yes,
    prompts: opts.prompts,
  })

  /** @type {boolean} */
  let production
  if (flags.production !== undefined) {
    production = Boolean(flags.production)
  } else if (yes || !canPrompt(opts)) {
    production = false
  } else {
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const picked = await p.confirm({
      message: 'Mark as production environment?',
      initialValue: false,
    })
    if (p.isCancel(picked)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    production = Boolean(picked)
  }

  /** @type {string | undefined} */
  let from = flags.from?.trim() || undefined
  if (from) {
    assertPackageName(from, '--from')
  } else if (!yes && canPrompt(opts)) {
    const root = requireInstanceRoot(opts.cwd)
    const existing = listEnvYamlNames(root)
    if (existing.length > 0) {
      const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
      const picked = await p.select({
        message: 'Copy env YAML from existing environment?',
        options: [
          { value: '', label: 'Start from stub / template' },
          ...existing.map((e) => ({ value: e, label: e })),
        ],
        initialValue: '',
      })
      if (p.isCancel(picked)) {
        p.cancel?.('Cancelled')
        throw new Error('cancelled')
      }
      from = picked ? String(picked) : undefined
    }
  }

  /** @type {boolean} */
  let syncEnvFromYaml
  if (flags.syncEnvFromYaml !== undefined) {
    syncEnvFromYaml = Boolean(flags.syncEnvFromYaml)
  } else if (yes || !canPrompt(opts)) {
    syncEnvFromYaml = false
  } else {
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const picked = await p.confirm({
      message: 'Sync provision/.env.schema from !env refs? (add-only)',
      initialValue: false,
    })
    if (p.isCancel(picked)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    syncEnvFromYaml = Boolean(picked)
  }

  return { name, force, production, from, syncEnvFromYaml }
}

/**
 * Peek uplink / vlan topology from common + env YAML (best-effort for Proxmox net prompts).
 * @param {string} root
 * @param {string} env
 * @returns {{ topology: NetworkingTopology } | null}
 */
export function peekNetworkingForEnv(root, env) {
  /** @type {Partial<NetworkingTopology>} */
  const merged = {}
  for (const rel of ['common.yaml', provisionEnvFile(env)]) {
    const path = join(root, 'provision', rel)
    if (!existsSync(path)) continue
    try {
      const doc = /** @type {{ networking?: Partial<NetworkingTopology> }} */ (
        YAML.parse(readFileSync(path, 'utf8')) ?? {}
      )
      if (doc.networking && typeof doc.networking === 'object' && !Array.isArray(doc.networking)) {
        Object.assign(merged, doc.networking)
      }
    } catch {
      // ignore parse errors; overlays fall back to eth0
    }
  }
  const uplinksRaw = merged.uplinks
  if (!uplinksRaw || typeof uplinksRaw !== 'object' || Array.isArray(uplinksRaw)) return null
  /** @type {NetworkingTopology} */
  const topology = {
    ports: merged.ports ?? {},
    uplinks: uplinksRaw,
    vlans: merged.vlans ?? {},
  }
  return { topology }
}

/**
 * @param {string | undefined} raw
 * @returns {'workstation' | 'proxmox' | null}
 */
export function parseTargetFlag(raw) {
  if (raw == null || raw === '') return null
  const t = String(raw).trim()
  if (t === 'workstation' || t === 'proxmox') return t
  throw new Error(`invalid --target '${raw}' (want workstation|proxmox)`)
}

/**
 * @typedef {object} NewProfileFlags
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 * @property {string} [env]
 * @property {string} [target]
 * @property {boolean} [setDefault]
 * @property {boolean} [skipOverlays]
 */

/**
 * @typedef {object} NewProfileResolved
 * @property {string} name
 * @property {boolean} force
 * @property {boolean} yes
 * @property {string} env
 * @property {'workstation' | 'proxmox'} target
 * @property {boolean} setDefault
 * @property {boolean} skipOverlays
 * @property {OverlaysWizardAnswers | null} overlays
 */

/**
 * Resolve profile scaffolding options (flags + optional TTY prompts + section D overlays).
 * @param {NewProfileFlags} flags
 * @param {{
 *   cwd?: string
 *   prompts?: NewPrompts
 *   preferTarget?: 'workstation' | 'proxmox'
 *   nameInitial?: string
 * }} [opts]
 * @returns {Promise<NewProfileResolved>}
 */
export async function resolveNewProfileOptions(flags, opts = {}) {
  const force = Boolean(flags.force)
  const yes = Boolean(flags.yes)
  const skipOverlaysFlag = Boolean(flags.skipOverlays)
  const root = requireInstanceRoot(opts.cwd)

  const name = await resolvePackageName(flags.name, {
    label: 'name',
    message: 'Profile name',
    placeholder: opts.nameInitial ?? (opts.preferTarget === 'proxmox' ? 'pve' : 'lab'),
    initialValue: opts.nameInitial,
    yes,
    prompts: opts.prompts,
  })

  /** @type {string} */
  let env = flags.env?.trim() || ''
  if (env) {
    assertPackageName(env, '--env')
  } else if (yes || !canPrompt(opts)) {
    throw new Error('env required (pass --env, or run on a TTY without --yes)')
  } else {
    const existing = listEnvironmentKeys(root)
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const picked = await p.select({
      message: 'Environment for this profile',
      options: [
        ...existing.map((e) => ({ value: e, label: e })),
        { value: '__new__', label: 'Create new environment…' },
      ],
      initialValue: existing[0] ?? '__new__',
    })
    if (p.isCancel(picked)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    if (picked === '__new__') {
      const envOpts = await resolveNewEnvOptions(
        { yes: false },
        { cwd: opts.cwd, prompts: opts.prompts },
      )
      newEnv(envOpts.name, {
        force: envOpts.force,
        production: envOpts.production,
        from: envOpts.from,
      })
      env = envOpts.name
    } else {
      env = String(picked)
    }
  }

  if (!listEnvironmentKeys(root).includes(env)) {
    throw new Error(
      `env ${JSON.stringify(env)} is not in qctl.environments. Run \`qctl new env\` first.`,
    )
  }

  /** @type {'workstation' | 'proxmox'} */
  let target
  const targetFlag = parseTargetFlag(flags.target)
  if (targetFlag) {
    target = targetFlag
  } else if (yes || !canPrompt(opts)) {
    target = opts.preferTarget ?? 'proxmox'
  } else {
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const targets = listProvisionTargets()
    const initial = opts.preferTarget ?? (targets.includes('proxmox') ? 'proxmox' : targets[0])
    const picked = await p.select({
      message: 'Hypervisor target',
      options: targets.map((t) => ({
        value: t,
        label: t,
        hint: t === 'proxmox' ? 'remote Proxmox VE' : 'VM on this machine',
      })),
      initialValue: initial,
    })
    if (p.isCancel(picked)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    target = /** @type {'workstation' | 'proxmox'} */ (picked)
  }
  if (!PROVISION_TARGETS.has(target)) {
    throw new Error(`invalid target '${target}' (want workstation|proxmox)`)
  }

  /** @type {boolean} */
  let setDefault
  if (flags.setDefault !== undefined) {
    setDefault = Boolean(flags.setDefault)
  } else if (yes || !canPrompt(opts)) {
    setDefault = false
  } else {
    const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
    const picked = await p.confirm({
      message: 'Set as default-profile?',
      initialValue: false,
    })
    if (p.isCancel(picked)) {
      p.cancel?.('Cancelled')
      throw new Error('cancelled')
    }
    setDefault = Boolean(picked)
  }

  const targetExists = targetLayerExists(root, target)
  const proxmoxStub =
    target === 'proxmox'
    && targetExists
    && (() => {
      try {
        const text = readFileSync(join(root, 'provision', provisionTargetFile(target)), 'utf8')
        return text.includes('SET_PROXMOX_API_TOKEN') || text.includes('pve.example')
      } catch {
        return false
      }
    })()
  const needOverlayWrite =
    !skipOverlaysFlag && (force || !targetExists || proxmoxStub || (!yes && target === 'proxmox'))

  /** @type {OverlaysWizardAnswers | null} */
  let overlays = null
  if (needOverlayWrite) {
    const networking = peekNetworkingForEnv(root, env)
    if (yes || !canPrompt(opts)) {
      const uplinkKeys = networking ? Object.keys(networking.topology.uplinks) : ['eth0']
      if (target === 'proxmox') overlays = { proxmox: defaultProxmoxOverlay(uplinkKeys) }
      else overlays = { workstation: defaultWorkstationOverlay() }
    } else {
      const overlayAns = await promptOverlays({
        prompts: opts.prompts,
        profiles: { [name]: { env, target } },
        networking,
      })
      if (typeof overlayAns === 'symbol') {
        const p = /** @type {NewPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
        p.cancel?.('Cancelled')
        throw new Error('cancelled')
      }
      overlays = overlayAns
    }
  }

  const skipOverlays = !needOverlayWrite

  return { name, force, yes, env, target, setDefault, skipOverlays, overlays }
}

/**
 * Write profile + optional target overlays (section D).
 * @param {NewProfileResolved} opts
 * @param {{ cwd?: string }} [ctx]
 * @returns {NewProfileResult & { overlayWritten: boolean }}
 */
export function scaffoldNewProfile(opts, ctx = {}) {
  const result = newProfile(opts.name, {
    cwd: ctx.cwd,
    force: opts.force,
    env: opts.env,
    target: opts.target,
    setDefault: opts.setDefault,
    ensureTargetStub: opts.overlays == null,
  })
  let overlayWritten = false
  if (opts.overlays && Object.keys(opts.overlays).length > 0) {
    applyOverlaysAnswers(result.root, opts.overlays, {
      profiles: { [opts.name]: { env: opts.env, target: opts.target } },
    })
    overlayWritten = true
  }
  return { ...result, overlayWritten }
}

/**
 * @param {string} name
 * @param {'workstation' | 'proxmox'} target
 * @returns {string}
 */
export function formatNewProfileOutro(name, target) {
  const p = `--profile ${name}`
  return [
    `Profile ${name} → ${target}.`,
    '',
    'Next:',
    `  qctl vm target-check ${p}`,
    `  qctl vm up ${p}`,
    `  qctl sync ${p}`,
    target === 'proxmox'
      ? 'SSH uses the guest IP from `qctl vm ssh-info` (not localhost forward).'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
