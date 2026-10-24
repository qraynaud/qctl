/**
 * Scaffold content for `qctl init` / `qctl new`.
 * Source of truth: `packages/host/templates/*.njk` (embedded via `bun --asset templates`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import nunjucks from 'nunjucks'
import YAML from 'yaml'

import { getScaffoldTemplatesRoot } from './templates-root.js'

/**
 * JSON-ish values for `| yaml` (scaffolds; no Buffer / !env bytes).
 * @typedef {null | boolean | number | string} ScaffoldYamlScalar
 * @typedef {{ [k: string]: ScaffoldYamlNode }} ScaffoldYamlMap
 * @typedef {ScaffoldYamlScalar | ScaffoldYamlNode[] | ScaffoldYamlMap} ScaffoldYamlNode
 */

/**
 * Context for env-dev / target-workstation scaffolds (Quickstart + initInstance).
 * @typedef {object} ProvisionTemplateVars
 * @property {number} cpu
 * @property {number} memory
 * @property {string | null} tankPassphrase formatted YAML value, or null to omit
 * @property {string | null} sshAuthorizedKey
 * @property {null | { vcs: string, url: string, dir: string, deployKey: string }} repo
 */

/** Loose env for scaffold stubs; no filesystem loader. */
const njk = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true,
})

/**
 * Object → YAML text (no trailing newline). Use with `indent` for nested keys:
 * `qctl:\n{{ qctl | yaml | indent(2) }}`
 * @param {ScaffoldYamlNode} value
 */
njk.addFilter('yaml', (value) => {
  if (value == null) return ''
  return YAML.stringify(value, { lineWidth: 100 }).replace(/\n$/, '')
})

/**
 * Prefix every non-empty line (Jinja-style indent).
 * @param {string} text
 * @param {number} [width]
 * @example {{ block | indent(2) }}
 */
njk.addFilter('indent', (text, width = 2) => {
  const n = Number(width)
  const pad = Number.isFinite(n) && n > 0 ? ' '.repeat(n) : ''
  return String(text ?? '')
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n')
})

/**
 * Render a Nunjucks string (`{{ name }}`, `{% if %}`, `| yaml`, `| indent`, etc.).
 * @template TVars
 * @param {string} text
 * @param {TVars} [vars]
 * @returns {string}
 */
export function renderTemplate(text, vars) {
  try {
    return njk.renderString(text, vars ?? {})
  } catch (err) {
    throw new Error(
      `scaffold template render failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * @param {string} rel Path under the templates root, with or without `.njk`
 * @returns {string}
 */
export function scaffoldTemplatePath(rel) {
  return rel.endsWith('.njk') ? rel : `${rel}.njk`
}

/**
 * Read a `.njk` scaffold file (no render).
 * @param {string} rel Path under the templates root (`.njk` optional)
 * @returns {string}
 */
export function readScaffoldTemplate(rel) {
  return readFileSync(join(getScaffoldTemplatesRoot(), scaffoldTemplatePath(rel)), 'utf8')
}

/**
 * Defaults for provision env-dev / target-workstation Nunjucks scaffolds
 * (Custom Enter-through + Quickstart `--yes`).
 * @returns {ProvisionTemplateVars}
 */
export function defaultProvisionTemplateVars() {
  return {
    cpu: 2,
    memory: 4096,
    tankPassphrase: 'lab-tank-passphrase',
    sshAuthorizedKey: null,
    repo: null,
  }
}

/**
 * Read and render a `.njk` scaffold file.
 * @template TVars
 * @param {string} rel
 * @param {TVars} [vars]
 * @returns {string}
 */
export function loadScaffoldTemplate(rel, vars) {
  return renderTemplate(readScaffoldTemplate(rel), vars)
}

/** @type {Record<'applications' | 'common' | 'networks', string>} */
const NEW_SCHEMA = {
  applications: 'new/applications.env.schema',
  common: 'new/common.env.schema',
  networks: 'new/networks.env.schema',
}

/** @type {Record<'applications' | 'common' | 'networks', string>} */
const NEW_SUBCOMMAND = {
  applications: 'app',
  common: 'common',
  networks: 'network',
}

/**
 * Per-package schema: import repo root (shared .env.dev / .env.prod), optional local files.
 * @param {'applications' | 'common' | 'networks'} kind
 * @param {string} name
 */
export function treeEnvSchema(kind, name) {
  const rel = NEW_SCHEMA[kind]
  if (!rel) throw new Error(`unknown package tree kind: ${kind}`)
  return loadScaffoldTemplate(rel, { name })
}

/**
 * @param {'applications' | 'common' | 'networks'} kind
 * @param {string} name
 */
export function packageReadme(kind, name) {
  const subcommand = NEW_SUBCOMMAND[kind]
  if (!subcommand) throw new Error(`unknown package tree kind: ${kind}`)
  return loadScaffoldTemplate('new/README.md', { name, subcommand })
}

/**
 * @param {'rootless' | 'rootful'} engine
 */
export function appYaml(engine) {
  return loadScaffoldTemplate('new/app.yaml', { engine })
}

/** Unit `.env.schema` under `applications/<app>/<unit>/`. */
export function unitEnvSchema() {
  return loadScaffoldTemplate('new/unit.env.schema', {})
}

/** Empty `.env.dev` stub beside a unit schema. */
export function unitEnvDevStub() {
  return loadScaffoldTemplate('new/unit.env.dev', {})
}

/**
 * Minimal demo Quadlet `.container` (httpd alpine).
 * @param {string} unit
 */
export function demoContainer(unit) {
  return loadScaffoldTemplate('new/demo.container', { unit })
}

/**
 * Commented Quadlet `.container` stub (standalone `new unit`).
 * @param {string} unit
 */
export function stubContainer(unit) {
  return loadScaffoldTemplate('new/stub.container', { unit })
}

/**
 * Commented Quadlet `.network` stub for `networks/<name>/<name>.network`.
 * @param {string} name
 */
export function networkQuadletStub(name) {
  return loadScaffoldTemplate('new/name.network', { name })
}
