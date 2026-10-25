/**
 * Writers for `qctl new env` / `qctl new profile` (prefixed provision layers).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import YAML from 'yaml'

import {
  loadQctlHostMeta,
  provisionEnvFile,
  provisionProfileFile,
  provisionTargetFile,
} from '@qctl/shared'

import { requireInstanceRoot } from '../new.js'
import {
  defaultProvisionTemplateVars,
  loadScaffoldTemplate,
  scaffoldTemplatePath,
} from '../templates.js'
import { getScaffoldTemplatesRoot } from '../templates-root.js'
import '../vm/drivers/index.js'
import {
  assertScaffoldTarget,
  listScaffoldTargets,
  resolveTargetYamlStub,
} from '../vm/drivers/scaffold.js'

/**
 * @typedef {object} NewEnvResult
 * @property {string} root
 * @property {string} name
 * @property {string[]} written
 * @property {string[]} skipped
 */

/**
 * @typedef {object} NewProfileResult
 * @property {string} root
 * @property {string} name
 * @property {string} env
 * @property {string} target
 * @property {string[]} written
 * @property {string[]} skipped
 */

/**
 * @typedef {{ production?: boolean }} EnvSpecPlain
 * @typedef {{ env: string, target: string }} ProfileSpecPlain
 * @typedef {{
 *   environments?: Record<string, EnvSpecPlain>
 *   profiles?: Record<string, ProfileSpecPlain>
 *   'default-profile'?: string | null
 * }} QctlPlain
 * @typedef {{ qctl?: QctlPlain }} CommonYamlDoc
 */

/**
 * @param {string} root
 * @returns {string[]}
 */
export function listEnvYamlNames(root) {
  const dir = join(root, 'provision')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.startsWith('env-') && n.endsWith('.yaml'))
    .map((n) => n.slice('env-'.length, -'.yaml'.length))
    .filter(Boolean)
    .sort()
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function listEnvironmentKeys(root) {
  return Object.keys(loadQctlHostMeta(root).environments).sort()
}

/**
 * @returns {string[]}
 */
export function listProvisionTargets() {
  return listScaffoldTargets()
}

/**
 * @param {string} path
 * @param {string} contents
 * @param {boolean} force
 * @returns {'wrote' | 'skipped'}
 */
function writeOrSkipFile(path, contents, force) {
  if (existsSync(path) && !force) return 'skipped'
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8')
  return 'wrote'
}

/**
 * @param {string} root
 * @returns {{ path: string, header: string, doc: CommonYamlDoc }}
 */
function readCommonYaml(root) {
  const path = join(root, 'provision', 'common.yaml')
  if (!existsSync(path)) {
    throw new Error(`missing ${path} — run \`qctl init\` first`)
  }
  const before = readFileSync(path, 'utf8')
  const commentMatch = before.match(/^(?:#[^\n]*\n)*/)
  const header = commentMatch?.[0] ?? ''
  const body = before.slice(header.length)
  /** @type {CommonYamlDoc} */
  let doc
  try {
    doc = /** @type {CommonYamlDoc} */ (YAML.parse(body) ?? {})
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { path, header, doc }
}

/**
 * @param {string} path
 * @param {string} header
 * @param {CommonYamlDoc} doc
 */
function writeCommonYaml(path, header, doc) {
  const text = header + YAML.stringify(doc, { lineWidth: 100 })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/**
 * @param {string} root
 * @param {string} name
 * @param {{ production?: boolean, force?: boolean }} [opts]
 * @returns {'wrote' | 'patched' | 'skipped'}
 */
export function ensureEnvironmentInCommon(root, name, opts = {}) {
  const { path, header, doc } = readCommonYaml(root)
  /** @type {QctlPlain} */
  const qctl =
    doc.qctl != null && typeof doc.qctl === 'object' && !Array.isArray(doc.qctl) ? doc.qctl : {}
  /** @type {Record<string, EnvSpecPlain>} */
  const environments = { ...(qctl.environments ?? {}) }

  const existed = name in environments
  if (existed && !opts.force) return 'skipped'

  environments[name] = opts.production ? { production: true } : {}
  qctl.environments = environments
  doc.qctl = qctl
  writeCommonYaml(path, header, doc)
  return existed ? 'patched' : 'wrote'
}

/**
 * @param {string} root
 * @param {string} name
 * @param {ProfileSpecPlain} spec
 * @param {{ force?: boolean, setDefault?: boolean }} [opts]
 * @returns {'wrote' | 'patched' | 'skipped'}
 */
export function ensureProfileInCommon(root, name, spec, opts = {}) {
  const { path, header, doc } = readCommonYaml(root)
  /** @type {QctlPlain} */
  const qctl =
    doc.qctl != null && typeof doc.qctl === 'object' && !Array.isArray(doc.qctl) ? doc.qctl : {}
  /** @type {Record<string, ProfileSpecPlain>} */
  const profiles = { ...(qctl.profiles ?? {}) }

  const existed = name in profiles
  if (existed && !opts.force) {
    if (opts.setDefault) {
      qctl['default-profile'] = name
      doc.qctl = qctl
      writeCommonYaml(path, header, doc)
      return 'patched'
    }
    return 'skipped'
  }

  profiles[name] = { env: spec.env, target: spec.target }
  qctl.profiles = profiles
  if (opts.setDefault) qctl['default-profile'] = name
  doc.qctl = qctl
  writeCommonYaml(path, header, doc)
  return existed ? 'patched' : 'wrote'
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
 * @param {ProfileSpecPlain} spec
 * @returns {string}
 */
function stubProfileYaml(profile, spec) {
  return `# Profile "${profile}" (env=${spec.env}, target=${spec.target}) — overrides for this profile only.
`
}

/**
 * @param {string} root
 * @param {string} name
 * @param {{ from?: string, force?: boolean }} [opts]
 * @returns {'wrote' | 'skipped'}
 */
export function writeEnvLayer(root, name, opts = {}) {
  const path = join(root, 'provision', provisionEnvFile(name))
  /** @type {string} */
  let contents
  if (opts.from) {
    const src = join(root, 'provision', provisionEnvFile(opts.from))
    if (!existsSync(src)) {
      throw new Error(`--from ${opts.from}: missing ${src}`)
    }
    contents = readFileSync(src, 'utf8')
  } else {
    const basename = provisionEnvFile(name).replace(/\.yaml$/, '')
    const full = join(getScaffoldTemplatesRoot(), scaffoldTemplatePath(`provision/${basename}`))
    contents = existsSync(full)
      ? loadScaffoldTemplate(`provision/${basename}`, defaultProvisionTemplateVars())
      : stubEnvYaml(name)
  }
  return writeOrSkipFile(path, contents, Boolean(opts.force))
}

/**
 * @param {string} root
 * @param {string} name
 * @param {{ force?: boolean }} [opts]
 * @returns {'wrote' | 'skipped'}
 */
export function writeProvisionEnvValues(root, name, opts = {}) {
  const path = join(root, 'provision', `.env.${name}`)
  const contents = `# Host bindings for provision !env (QCTL_ENV=${name}).\n# ---\n`
  return writeOrSkipFile(path, contents, Boolean(opts.force))
}

/**
 * @param {string} root
 * @param {string} name
 * @param {ProfileSpecPlain} spec
 * @param {{ force?: boolean }} [opts]
 * @returns {'wrote' | 'skipped'}
 */
export function writeProfileLayer(root, name, spec, opts = {}) {
  const path = join(root, 'provision', provisionProfileFile(name))
  return writeOrSkipFile(path, stubProfileYaml(name, spec), Boolean(opts.force))
}

/**
 * Ensure a stub `target-<target>.yaml` exists (interactive overlays fill it later).
 * @param {string} root
 * @param {string} target
 * @param {{ force?: boolean }} [opts]
 * @returns {'wrote' | 'skipped'}
 */
export function writeTargetLayerStub(root, target, opts = {}) {
  const id = assertScaffoldTarget(target)
  const path = join(root, 'provision', provisionTargetFile(id))
  return writeOrSkipFile(path, resolveTargetYamlStub(id), Boolean(opts.force))
}

/**
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function targetLayerExists(root, target) {
  return existsSync(join(root, 'provision', provisionTargetFile(target)))
}

/**
 * @param {string} name
 * @param {{
 *   cwd?: string
 *   force?: boolean
 *   production?: boolean
 *   from?: string
 * }} [opts]
 * @returns {NewEnvResult}
 */
export function newEnv(name, opts = {}) {
  const root = requireInstanceRoot(opts.cwd)
  /** @type {string[]} */
  const written = []
  /** @type {string[]} */
  const skipped = []

  const commonAction = ensureEnvironmentInCommon(root, name, {
    production: Boolean(opts.production),
    force: Boolean(opts.force),
  })
  if (commonAction === 'skipped') skipped.push('provision/common.yaml (environments)')
  else written.push(`provision/common.yaml (environments:${commonAction})`)

  const envAction = writeEnvLayer(root, name, { from: opts.from, force: opts.force })
  const envRel = `provision/${provisionEnvFile(name)}`
  if (envAction === 'skipped') skipped.push(envRel)
  else written.push(envRel)

  const valuesAction = writeProvisionEnvValues(root, name, { force: opts.force })
  const valuesRel = `provision/.env.${name}`
  if (valuesAction === 'skipped') skipped.push(valuesRel)
  else written.push(valuesRel)

  return { root, name, written, skipped }
}

/**
 * Register profile + write profile-*.yaml (+ stub target file when missing).
 * Hypervisor detail for new targets is applied by the caller via applyOverlaysAnswers.
 * @param {string} name
 * @param {{
 *   cwd?: string
 *   force?: boolean
 *   env: string
 *   target: string
 *   setDefault?: boolean
 *   ensureTargetStub?: boolean
 * }} opts
 * @returns {NewProfileResult}
 */
export function newProfile(name, opts) {
  const root = requireInstanceRoot(opts.cwd)
  const meta = loadQctlHostMeta(root)
  if (!(opts.env in meta.environments)) {
    const keys = Object.keys(meta.environments).sort().join(', ')
    throw new Error(
      `env ${JSON.stringify(opts.env)} is not in qctl.environments (${keys}). Run \`qctl new env\` first.`,
    )
  }
  const target = assertScaffoldTarget(opts.target)

  const spec = { env: opts.env, target }
  /** @type {string[]} */
  const written = []
  /** @type {string[]} */
  const skipped = []

  const commonAction = ensureProfileInCommon(root, name, spec, {
    force: Boolean(opts.force),
    setDefault: Boolean(opts.setDefault),
  })
  if (commonAction === 'skipped') skipped.push('provision/common.yaml (profiles)')
  else written.push(`provision/common.yaml (profiles:${commonAction})`)

  const profileAction = writeProfileLayer(root, name, spec, { force: opts.force })
  const profileRel = `provision/${provisionProfileFile(name)}`
  if (profileAction === 'skipped') skipped.push(profileRel)
  else written.push(profileRel)

  if (opts.ensureTargetStub !== false && !targetLayerExists(root, target)) {
    const tAction = writeTargetLayerStub(root, target, { force: false })
    const tRel = `provision/${provisionTargetFile(target)}`
    if (tAction === 'skipped') skipped.push(tRel)
    else written.push(tRel)
  }

  return { root, name, env: opts.env, target, written, skipped }
}
