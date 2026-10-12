/**
 * Nunjucks env + !template / !file YAML tags for NoCloud seed rendering.
 */
import nunjucks from 'nunjucks'
import YAML from 'yaml'
import { chalk, fs, path } from 'zx'

import { getSeedKit } from '../../../lib/paths.js'
import { die } from '../../../lib/util.js'

/** @import { Environment } from 'nunjucks' */
/** @import { YamlMapping, YamlValue } from '@qctl/shared' */
/** @import { buildVars } from './vars.js' */

/** @typedef {YamlMapping} CloudConfig */
/** @typedef {Awaited<ReturnType<typeof buildVars>>} SeedVars */
/**
 * Parsed seed YAML while `OMIT` sentinels may still be present.
 * @typedef {YamlValue | typeof OMIT | SeedNode[] | { [key: string]: SeedNode }} SeedNode
 */

/** Sentinel: drop write_files entries whose content resolved to this. */
export const OMIT = Symbol('omit')

/** @type {{ root: string, env: Environment } | null} */
let njkCache = null

/**
 * Nunjucks env rooted at the Rocky seed kit (created lazily per root).
 * @returns {Environment}
 */
function getNjk() {
  const root = getSeedKit()
  if (njkCache?.root === root) return njkCache.env
  const env = nunjucks.configure(root, {
    autoescape: false,
    throwOnUndefined: true,
    noCache: true,
    tags: {
      blockStart: '{%',
      blockEnd: '%}',
      variableStart: '{{',
      variableEnd: '}}',
      commentStart: '[#',
      commentEnd: '#]',
    },
  })
  /** list | named('ssh') → entry with that name, or null */
  env.addFilter('named', (/** @type {YamlValue} */ list, /** @type {string} */ name) => {
    if (!Array.isArray(list)) return null
    return (
      list.find(
        (p) =>
          p
          && typeof p === 'object'
          && !Array.isArray(p)
          && /** @type {YamlMapping} */ (p).name === name,
      ) || null
    )
  })
  njkCache = { root, env }
  return env
}

/**
 * @param {string} rel
 * @returns {string}
 */
function fileStub(rel) {
  return [
    '#!/usr/bin/env bash',
    `# Placeholder — seed-kit/${rel} not available`,
    'set -euo pipefail',
    `echo "rocky: stub for seed-kit/${rel}" >&2`,
    '',
  ].join('\n')
}

/**
 * @param {string} rel
 * @returns {string}
 */
function unitStub(rel) {
  return [
    '[Unit]',
    `Description=Stub — add seed-kit/${rel}`,
    '[Service]',
    'Type=oneshot',
    'ExecStart=/bin/true',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

/**
 * @param {string} out
 * @returns {string | typeof OMIT}
 */
function emptyToOmit(out) {
  return out.trim() === '' ? OMIT : out
}

/**
 * Render seed-kit/<rel> (Nunjucks via path so {% include %} works).
 * @param {string} rel
 * @param {SeedVars} ctx
 * @returns {string | typeof OMIT | null}
 */
export function renderProvisionFile(rel, ctx) {
  const abs = path.join(getSeedKit(), rel)
  if (!fs.existsSync(abs)) return null
  const raw = fs.readFileSync(abs, 'utf8')
  if (!/\{\{|\{%/.test(raw)) return raw
  try {
    return emptyToOmit(getNjk().render(rel, ctx))
  } catch (err) {
    die(`nunjucks seed-kit/${rel}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * @param {string | null | undefined} src
 * @param {SeedVars} ctx
 * @returns {string | typeof OMIT}
 */
function resolveTemplate(src, ctx) {
  const body = String(src ?? '')
  try {
    const out = emptyToOmit(getNjk().renderString(body, ctx))
    console.log(chalk.dim(out === OMIT ? '  !template (omit)' : '  !template'))
    return out
  } catch (err) {
    die(`nunjucks !template: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * @param {SeedVars} ctx
 * @param {boolean | undefined} allowMissingFiles
 */
function createCustomTags(ctx, allowMissingFiles) {
  return [
    {
      tag: '!template',
      /** @param {string} src */
      resolve(src) {
        return resolveTemplate(src, ctx)
      },
    },
    {
      tag: '!file',
      /** @param {string} rel */
      resolve(rel) {
        const rendered = renderProvisionFile(rel, ctx)
        if (rendered === OMIT) {
          console.log(chalk.dim(`  !file ${rel} (omit)`))
          return OMIT
        }
        if (rendered != null) {
          console.log(chalk.dim(`  !file ${rel}`))
          return rendered
        }
        if (!allowMissingFiles) {
          die(`missing !file seed-kit/${rel} (or pass --allow-missing-files)`)
        }
        console.warn(chalk.yellow(`vm seed: stub !file seed-kit/${rel}`))
        return rel.endsWith('.service') || rel.endsWith('.timer') ? unitStub(rel) : fileStub(rel)
      },
    },
  ]
}

/**
 * Recursively drop OMIT sentinels from a parsed YAML tree (mutates objects).
 * @param {SeedNode} node
 * @returns {SeedNode}
 */
function pruneOmits(node) {
  if (node === OMIT) return OMIT
  if (Array.isArray(node)) {
    return node.map(pruneOmits).filter((x) => x !== OMIT)
  }
  if (node && typeof node === 'object') {
    const rec = /** @type {{ [key: string]: SeedNode }} */ (node)
    if (Array.isArray(rec.write_files)) {
      rec.write_files = rec.write_files.filter(
        (w) => w && typeof w === 'object' && !Array.isArray(w) && w.content !== OMIT,
      )
    }
    for (const [k, v] of Object.entries(rec)) {
      const next = pruneOmits(v)
      if (next === OMIT) delete rec[k]
      else rec[k] = next
    }
  }
  return node
}

/**
 * @param {string} filePath
 * @param {SeedVars} vars
 * @param {boolean | undefined} allowMissingFiles
 * @returns {CloudConfig}
 */
export function renderTemplate(filePath, vars, allowMissingFiles) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const doc = /** @type {SeedNode} */ (
    YAML.parse(raw, { customTags: createCustomTags(vars, allowMissingFiles) })
  )
  return /** @type {CloudConfig} */ (pruneOmits(doc))
}
