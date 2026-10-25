/**
 * Write / ensure provision layers: common.yaml (environments + profiles),
 * target-*.yaml, env-*.yaml, profile-*.yaml, provision env graph stubs, README.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { provisionEnvFile, provisionProfileFile, provisionTargetFile } from '@qctl/shared'

import {
  defaultProvisionTemplateVars,
  loadScaffoldTemplate,
  scaffoldTemplatePath,
} from '../templates.js'
import { getScaffoldTemplatesRoot } from '../templates-root.js'
import '../vm/drivers/index.js'
import { assertScaffoldTarget, resolveTargetYamlStub } from '../vm/drivers/scaffold.js'

/** @import { ProvisionFileInput } from '../provision/schema/types.js' */
/** @import { ProvisionTemplateVars } from '../templates.js' */

/**
 * @typedef {object} EnvironmentWriteSpec
 * @property {boolean} [production]
 */

/**
 * @typedef {object} ProfileWriteSpec
 * @property {string} env
 * @property {string} target
 */

/** Extra common.yaml keys (e.g. networking) when multi-env shares topology. */
/** @typedef {Partial<Omit<ProvisionFileInput, 'qctl'>>} SharedTopologyExtras */

/**
 * `qctl:` block written into common.yaml.
 * @typedef {object} CommonQctlYaml
 * @property {string} platform
 * @property {Record<string, EnvironmentWriteSpec>} environments
 * @property {Record<string, ProfileWriteSpec>} profiles
 * @property {string | null} [default-profile]
 */

/**
 * @typedef {object} ProvisionWriteMeta
 * @property {string} [platform]
 * @property {Record<string, EnvironmentWriteSpec>} environments
 * @property {Record<string, ProfileWriteSpec>} profiles
 * @property {string | null} [defaultProfile]
 *   Profile key, or `null` to write `default-profile: null` (require `-p`)
 * @property {SharedTopologyExtras} [sharedTopology]
 */

/**
 * @typedef {object} LayoutReport
 * @property {string[]} written
 * @property {string[]} patched
 * @property {string[]} skipped
 */

/**
 * Quickstart / `--yes` default: single lab profile on workstation.
 * @returns {ProvisionWriteMeta}
 */
export function defaultQuickstartProvisionMeta() {
  return {
    platform: 'rocky',
    environments: {
      dev: {},
    },
    profiles: {
      lab: { env: 'dev', target: 'workstation' },
    },
    // Sole profile → omit default-profile; loader treats it as the default.
  }
}

/**
 * @param {LayoutReport} report
 * @param {string} rel
 * @param {'wrote' | 'patched' | 'skipped'} action
 */
function track(report, rel, action) {
  if (action === 'wrote') report.written.push(rel)
  else if (action === 'patched') report.patched.push(rel)
  else report.skipped.push(rel)
}

/**
 * @param {string} path
 * @param {string} contents
 * @param {{ force?: boolean, dryRun?: boolean }} opts
 * @param {LayoutReport} report
 * @param {string} rel
 */
function writeOrSkip(path, contents, opts, report, rel) {
  const exists = existsSync(path)
  if (exists && !opts.force) {
    track(report, rel, 'skipped')
    return
  }
  if (!opts.dryRun) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents, 'utf8')
  }
  track(report, rel, 'wrote')
}

/**
 * @param {EnvironmentWriteSpec | undefined} spec
 * @returns {EnvironmentWriteSpec}
 */
function envYamlValue(spec) {
  if (spec?.production) return { production: true }
  return {}
}

/**
 * Render `provision/common.yaml` from structured meta (+ optional shared topology).
 * Uses `provision/common.yaml.njk` with `| yaml` / `| indent` filters.
 * @param {ProvisionWriteMeta} meta
 * @returns {string}
 */
export function renderCommonYaml(meta) {
  const platform = meta.platform ?? 'rocky'
  /** @type {Record<string, EnvironmentWriteSpec>} */
  const environments = {}
  for (const [key, spec] of Object.entries(meta.environments)) {
    environments[key] = envYamlValue(spec)
  }
  /** @type {Record<string, ProfileWriteSpec>} */
  const profiles = {}
  for (const [key, spec] of Object.entries(meta.profiles)) {
    profiles[key] = { env: spec.env, target: spec.target }
  }

  /** @type {CommonQctlYaml} */
  const qctl = {
    platform,
    environments,
    profiles,
  }
  // `null` → explicit none; string → set; `undefined` → omit (sole-profile auto-default)
  if (meta.defaultProfile === null) qctl['default-profile'] = null
  else if (meta.defaultProfile != null && meta.defaultProfile !== '') {
    qctl['default-profile'] = meta.defaultProfile
  }

  /** @type {SharedTopologyExtras | null} */
  let shared = null
  if (meta.sharedTopology && Object.keys(meta.sharedTopology).length > 0) {
    shared = meta.sharedTopology
  }

  return loadScaffoldTemplate('provision/common.yaml', { qctl, shared })
}

/**
 * @param {string} relUnderProvision Path relative to provision/ without .njk
 * @param {ProvisionTemplateVars} [vars]
 * @returns {string | null}
 */
function tryLoadProvisionTemplate(relUnderProvision, vars = defaultProvisionTemplateVars()) {
  const root = getScaffoldTemplatesRoot()
  const full = join(root, scaffoldTemplatePath(`provision/${relUnderProvision}`))
  if (!existsSync(full)) return null
  return loadScaffoldTemplate(`provision/${relUnderProvision}`, vars)
}

/**
 * @param {string} env
 * @returns {string}
 */
function stubEnvYaml(env) {
  return `# Env "${env}" — shared by profiles that use env: ${env}.
# Secrets: !env NAME → provision/.env.${env}. Profiles: common.yaml.
`
}

/**
 * @param {string} profile
 * @param {ProfileWriteSpec} spec
 * @returns {string}
 */
function stubProfileYaml(profile, spec) {
  return `# Profile "${profile}" (env=${spec.env}, target=${spec.target}) — overrides for this profile only.
`
}

/**
 * Write provision tree under instance `root`.
 * @param {string} root
 * @param {{
 *   force?: boolean,
 *   dryRun?: boolean,
 *   meta?: ProvisionWriteMeta,
 *   extraTargets?: string[],
 *   extraOverlays?: { env: string, target: string }[],
 *   provisionEnvFiles?: string[],
 *   templateVars?: Partial<ProvisionTemplateVars>,
 * }} [opts]
 * @returns {LayoutReport}
 */
export function writeProvision(root, opts = {}) {
  const force = Boolean(opts.force)
  const dryRun = Boolean(opts.dryRun)
  const meta = opts.meta ?? defaultQuickstartProvisionMeta()
  /** @type {ProvisionTemplateVars} */
  const templateVars = { ...defaultProvisionTemplateVars(), ...opts.templateVars }
  const fileOpts = { force, dryRun }
  /** @type {LayoutReport} */
  const report = { written: [], patched: [], skipped: [] }

  const provisionDir = join(root, 'provision')
  if (!dryRun) mkdirSync(provisionDir, { recursive: true })

  // common.yaml
  writeOrSkip(
    join(provisionDir, 'common.yaml'),
    renderCommonYaml(meta),
    fileOpts,
    report,
    'provision/common.yaml',
  )

  // README + empty secret schema
  writeOrSkip(
    join(provisionDir, 'README.md'),
    loadScaffoldTemplate('provision/README.md'),
    fileOpts,
    report,
    'provision/README.md',
  )
  writeOrSkip(
    join(provisionDir, '.env.schema'),
    loadScaffoldTemplate('provision/.env.schema'),
    fileOpts,
    report,
    'provision/.env.schema',
  )

  const envFiles = opts.provisionEnvFiles ?? ['dev', 'prod']
  for (const env of envFiles) {
    const rel = `provision/.env.${env}`
    const template =
      tryLoadProvisionTemplate(`.env.${env}`, templateVars)
      ?? `# Host bindings for provision !env (QCTL_ENV=${env}).\n# ---\n`
    writeOrSkip(join(root, rel), template, fileOpts, report, rel)
  }

  // Target layers (unique targets from profiles + extras) — stubs via driver registry
  /** @type {Set<string>} */
  const targets = new Set()
  for (const spec of Object.values(meta.profiles)) targets.add(assertScaffoldTarget(spec.target))
  for (const t of opts.extraTargets ?? []) targets.add(assertScaffoldTarget(t))
  for (const extra of opts.extraOverlays ?? []) targets.add(assertScaffoldTarget(extra.target))

  for (const target of targets) {
    const basename = provisionTargetFile(target)
    const rel = `provision/${basename}`
    const contents =
      tryLoadProvisionTemplate(basename, templateVars) ?? resolveTargetYamlStub(target)
    writeOrSkip(join(root, rel), contents, fileOpts, report, rel)
  }

  // Env layers
  for (const env of Object.keys(meta.environments)) {
    const basename = provisionEnvFile(env)
    const rel = `provision/${basename}`
    const contents = tryLoadProvisionTemplate(basename, templateVars) ?? stubEnvYaml(env)
    writeOrSkip(join(root, rel), contents, fileOpts, report, rel)
  }

  // Profile layers (one file per profile key)
  for (const [profile, spec] of Object.entries(meta.profiles)) {
    const basename = provisionProfileFile(profile)
    const rel = `provision/${basename}`
    const contents =
      tryLoadProvisionTemplate(basename, templateVars) ?? stubProfileYaml(profile, spec)
    writeOrSkip(join(root, rel), contents, fileOpts, report, rel)
  }

  return report
}

/**
 * @param {LayoutReport} a
 * @param {LayoutReport} b
 * @returns {LayoutReport}
 */
export function mergeWriteReports(a, b) {
  return {
    written: [...a.written, ...b.written],
    patched: [...a.patched, ...b.patched],
    skipped: [...a.skipped, ...b.skipped],
  }
}
