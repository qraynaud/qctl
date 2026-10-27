/**
 * Write / ensure instance layout files from `packages/host/templates/*.njk`.
 * (mise, package.json, .gitignore, root env schema/values, empty trees)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { ensureLine, injectAfter, lineMatchesKey, parseLines } from '../lib/line-edit.js'
import { loadScaffoldTemplate } from '../templates.js'

/** Required `.gitignore` patterns (exact lines). */
export const GITIGNORE_REQUIRED = Object.freeze([
  '.env',
  '.env.local',
  '.env.*.local',
  'node_modules/',
])

/** Mise tool line from the scaffold template. */
export const MISE_QCTL_TOOL_LINE =
  '"github:qraynaud/qctl" = { version = "latest", asset_pattern = "qctl-host", bin = "qctl" }'

/** @typedef {'wrote' | 'patched' | 'skipped'} LayoutAction */

/**
 * @typedef {object} LayoutReport
 * @property {string[]} written
 * @property {string[]} patched
 * @property {string[]} skipped
 */

/**
 * @param {LayoutReport} report
 * @param {string} rel
 * @param {LayoutAction} action
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
 * @param {string} path
 * @param {string} next
 * @param {string} before
 * @param {{ dryRun?: boolean }} opts
 * @param {LayoutReport} report
 * @param {string} rel
 */
function applyPatch(path, next, before, opts, report, rel) {
  if (next === before) {
    track(report, rel, 'skipped')
    return
  }
  if (!opts.dryRun) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, next, 'utf8')
  }
  track(report, rel, existsSync(path) || before !== '' ? 'patched' : 'wrote')
}

/**
 * @param {string} name
 * @param {{ dependencies?: Record<string, string> }} [opts]
 * @returns {string}
 */
export function packageJsonContents(name, opts = {}) {
  const pkg = JSON.parse(loadScaffoldTemplate('package.json'))
  pkg.name = name
  if (opts.dependencies && Object.keys(opts.dependencies).length > 0) {
    pkg.dependencies = { ...(pkg.dependencies ?? {}), ...opts.dependencies }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/**
 * Ensure package.json has name / private / type (JSON round-trip).
 * @param {string} text
 * @param {string} name
 * @param {{ dependencies?: Record<string, string> }} [opts]
 * @returns {{ text: string, changed: boolean }}
 */
export function ensurePackageJson(text, name, opts = {}) {
  /** @type {{ name?: string, private?: boolean, type?: string, dependencies?: Record<string, string> }} */
  let pkg
  try {
    pkg = /** @type {typeof pkg} */ (JSON.parse(text))
  } catch {
    return { text: packageJsonContents(name, opts), changed: true }
  }
  let changed = false
  if (pkg.name !== name) {
    pkg.name = name
    changed = true
  }
  if (pkg.private !== true) {
    pkg.private = true
    changed = true
  }
  if (pkg.type !== 'module') {
    pkg.type = 'module'
    changed = true
  }
  if (pkg.dependencies == null || typeof pkg.dependencies !== 'object') {
    pkg.dependencies = {}
    changed = true
  }
  for (const [dep, ver] of Object.entries(opts.dependencies ?? {})) {
    if (pkg.dependencies[dep] !== ver) {
      pkg.dependencies[dep] = ver
      changed = true
    }
  }
  const next = `${JSON.stringify(pkg, null, 2)}\n`
  return { text: next, changed: changed || next !== text }
}

/**
 * @param {string} text
 * @returns {{ text: string, changed: boolean }}
 */
export function ensureMiseToml(text) {
  let next = text
  let changed = false
  const tools = ensureLine(next, '[tools]')
  next = tools.text
  changed = changed || tools.changed
  if (!parseLines(next).lines.includes(MISE_QCTL_TOOL_LINE)) {
    const placed = injectAfter(next, '[tools]', MISE_QCTL_TOOL_LINE, {
      appendIfMissing: true,
    })
    next = placed.text
    changed = true
  }
  return { text: next, changed }
}

/**
 * @param {string} text
 * @returns {{ text: string, changed: boolean }}
 */
export function ensureGitignore(text) {
  let next = text
  let changed = false
  for (const line of GITIGNORE_REQUIRED) {
    const r = ensureLine(next, line)
    next = r.text
    changed = changed || r.changed
  }
  return { text: next, changed }
}

/**
 * Ensure root `.env.schema` has QCTL_ENV + internal ENV/TZ stubs.
 * @param {string} text
 * @returns {{ text: string, changed: boolean }}
 */
export function ensureRootEnvSchema(text) {
  let next = text
  let changed = false

  if (!parseLines(next).lines.some((l) => lineMatchesKey(l, 'QCTL_ENV'))) {
    const stub = [
      '# @type=string',
      '# @public',
      'QCTL_ENV=dev',
      '',
      '# @internal @public @optional',
      'ENV=',
      '# @internal @public @optional',
      'TZ=',
    ].join('\n')
    next = next === '' || next.endsWith('\n') ? `${next}${stub}\n` : `${next}\n${stub}\n`
    return { text: next, changed: true }
  }

  for (const key of ['ENV', 'TZ']) {
    if (!parseLines(next).lines.some((l) => lineMatchesKey(l, key))) {
      const block = `# @internal @public @optional\n${key}=`
      next = next.endsWith('\n') ? `${next}${block}\n` : `${next}\n${block}\n`
      changed = true
    }
  }
  return { text: next, changed }
}

/** Rel paths under the instance root for agent skill scaffolds. */
export const AI_SKILL_RELS = Object.freeze(['AGENTS.md', '.cursor/skills/qctl-provision/SKILL.md'])

/**
 * Write or ensure instance layout under `root`.
 * @param {string} root Absolute instance root
 * @param {{
 *   force?: boolean,
 *   dryRun?: boolean,
 *   name?: string,
 *   envs?: string[],
 *   dependencies?: Record<string, string>,
 *   aiSkills?: boolean,
 * }} [opts]
 * @returns {LayoutReport}
 */
export function writeLayout(root, opts = {}) {
  const force = Boolean(opts.force)
  const dryRun = Boolean(opts.dryRun)
  const name = opts.name ?? basename(root)
  const envs = opts.envs ?? ['dev', 'prod']
  const dependencies = opts.dependencies ?? {}
  const aiSkills = opts.aiSkills !== false
  /** @type {LayoutReport} */
  const report = { written: [], patched: [], skipped: [] }
  const fileOpts = { force, dryRun }

  if (!dryRun) mkdirSync(root, { recursive: true })

  // mise.toml
  {
    const rel = 'mise.toml'
    const path = join(root, rel)
    const template = loadScaffoldTemplate('mise.toml')
    if (!existsSync(path) || force) {
      writeOrSkip(path, template, fileOpts, report, rel)
    } else {
      const before = readFileSync(path, 'utf8')
      const { text, changed } = ensureMiseToml(before)
      if (changed) applyPatch(path, text, before, fileOpts, report, rel)
      else track(report, rel, 'skipped')
    }
  }

  // package.json
  {
    const rel = 'package.json'
    const path = join(root, rel)
    const pkgOpts = { dependencies }
    if (!existsSync(path) || force) {
      writeOrSkip(path, packageJsonContents(name, pkgOpts), fileOpts, report, rel)
    } else {
      const before = readFileSync(path, 'utf8')
      const { text, changed } = ensurePackageJson(before, name, pkgOpts)
      if (changed) applyPatch(path, text, before, fileOpts, report, rel)
      else track(report, rel, 'skipped')
    }
  }

  // .gitignore
  {
    const rel = '.gitignore'
    const path = join(root, rel)
    const template = loadScaffoldTemplate('.gitignore')
    if (!existsSync(path) || force) {
      writeOrSkip(path, template, fileOpts, report, rel)
    } else {
      const before = readFileSync(path, 'utf8')
      const { text, changed } = ensureGitignore(before)
      if (changed) applyPatch(path, text, before, fileOpts, report, rel)
      else track(report, rel, 'skipped')
    }
  }

  // root .env.schema
  {
    const rel = '.env.schema'
    const path = join(root, rel)
    const template = loadScaffoldTemplate('.env.schema')
    if (!existsSync(path) || force) {
      writeOrSkip(path, template, fileOpts, report, rel)
    } else {
      const before = readFileSync(path, 'utf8')
      const { text, changed } = ensureRootEnvSchema(before)
      if (changed) applyPatch(path, text, before, fileOpts, report, rel)
      else track(report, rel, 'skipped')
    }
  }

  // root .env.<env>
  for (const env of envs) {
    const rel = `.env.${env}`
    const path = join(root, rel)
    if (!existsSync(path) || force) {
      const templateRel = env === 'dev' || env === 'prod' ? `.env.${env}` : null
      const contents = templateRel
        ? loadScaffoldTemplate(templateRel)
        : `# Values for QCTL_ENV=${env}\n`
      writeOrSkip(path, contents, fileOpts, report, rel)
    } else {
      track(report, rel, 'skipped')
    }
  }

  // empty trees
  for (const tree of ['applications', 'common', 'networks']) {
    const dir = join(root, tree)
    if (!dryRun) mkdirSync(dir, { recursive: true })
    const rel = `${tree}/.gitkeep`
    const path = join(root, rel)
    if (!existsSync(path) || force) {
      writeOrSkip(path, '', fileOpts, report, rel)
    } else {
      track(report, rel, 'skipped')
    }
  }

  // Agent skills (default on; skip with aiSkills: false / --no-ai-skills).
  // Existing files are left alone unless --force (do not clobber user edits).
  if (aiSkills) {
    for (const rel of AI_SKILL_RELS) {
      const path = join(root, rel)
      const contents = loadScaffoldTemplate(rel)
      writeOrSkip(path, contents, fileOpts, report, rel)
    }
  }

  return report
}
