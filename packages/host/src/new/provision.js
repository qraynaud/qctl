/**
 * Writers for `qctl new env` (prefixed provision layers).
 * Target layers are created by init / `qctl new profile`, not a separate overlay command.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import YAML from 'yaml'

import { provisionEnvFile } from '@qctl/shared'

import { requireInstanceRoot } from '../new.js'
import {
  defaultProvisionTemplateVars,
  loadScaffoldTemplate,
  scaffoldTemplatePath,
} from '../templates.js'
import { getScaffoldTemplatesRoot } from '../templates-root.js'

/**
 * @typedef {object} NewEnvResult
 * @property {string} root
 * @property {string} name
 * @property {string[]} written
 * @property {string[]} skipped
 */

/**
 * @typedef {{ production?: boolean }} EnvSpecPlain
 * @typedef {{ environments?: Record<string, EnvSpecPlain> }} QctlPlain
 * @typedef {{ qctl?: QctlPlain }} CommonYamlDoc
 */

/**
 * Env keys that already have `env-<name>.yaml` (for `--from` select).
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
 * Patch `qctl.environments.<name>` into common.yaml (preserve comment header).
 * @param {string} root
 * @param {string} name
 * @param {{ production?: boolean, force?: boolean }} [opts]
 * @returns {'wrote' | 'patched' | 'skipped'}
 */
export function ensureEnvironmentInCommon(root, name, opts = {}) {
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

  const text = header + YAML.stringify(doc, { lineWidth: 100 })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
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
