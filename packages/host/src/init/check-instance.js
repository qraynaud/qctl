/**
 * Read-only instance health checks for `qctl init --check`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  collectEnvRefs,
  isInstanceRoot,
  loadEnvGraphForDir,
  loadQctlHostMeta,
  parseProvisionYaml,
  resolveProfile,
} from '@qctl/shared'

import { parseLines } from '../lib/line-edit.js'
import { clearEnvProvisionCache, loadEnvProvisionSafe } from '../lib/load-config.js'
import { createCheckReport } from '../vm/libs/check-report.js'

const PHYSICAL_PLACEHOLDER_RE = /SET_PHYSICAL_DISK_ID/

/** Layout files expected on a healthy instance (ensure / check). */
export const REQUIRED_INSTANCE_FILES = Object.freeze([
  'mise.toml',
  'package.json',
  '.gitignore',
  '.env.schema',
  'provision/common.yaml',
  'provision/.env.schema',
  'provision/README.md',
])

/**
 * @param {string} schemaText
 * @returns {Set<string>}
 */
function schemaKeySet(schemaText) {
  /** @type {Set<string>} */
  const keys = new Set()
  for (const line of parseLines(schemaText).lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    keys.add(t.slice(0, eq).trim())
  }
  return keys
}

/**
 * Collect `!env` names from all provision YAML files.
 * @param {string} provisionDir
 * @returns {{ refs: Set<string>, placeholders: string[] }}
 */
export function scanProvisionYaml(provisionDir) {
  /** @type {Set<string>} */
  const refs = new Set()
  /** @type {string[]} */
  const placeholders = []
  if (!existsSync(provisionDir)) return { refs, placeholders }

  for (const name of readdirSync(provisionDir)) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    const rel = `provision/${name}`
    const text = readFileSync(join(provisionDir, name), 'utf8')
    if (PHYSICAL_PLACEHOLDER_RE.test(text)) placeholders.push(rel)
    try {
      const doc = parseProvisionYaml(text)
      for (const ref of collectEnvRefs(doc)) refs.add(ref)
    } catch {
      // ignore parse errors here; provision load will fail separately
    }
  }
  return { refs, placeholders }
}

/**
 * @param {string} root
 * @param {{ profile?: string }} [opts]
 * @returns {Promise<boolean>} true if all checks passed
 */
export async function checkInstance(root, opts = {}) {
  const report = createCheckReport('init', { headline: 'init --check' })
  const prevCwd = process.cwd()

  report.section('Instance layout')
  if (!isInstanceRoot(root)) {
    report.fail(`${root} is not a qctl instance (need provision/ with qctl:)`)
    return report.finish()
  }
  report.ok('provision/ looks like an instance root')

  for (const rel of REQUIRED_INSTANCE_FILES) {
    if (existsSync(join(root, rel))) report.ok(rel)
    else report.fail(`missing ${rel}`)
  }

  report.section('Profiles + provision')
  try {
    process.chdir(root)
    clearEnvProvisionCache()

    const meta = loadQctlHostMeta(root)
    const profileKeys = Object.keys(meta.profiles)
    if (profileKeys.length === 0) {
      report.fail('no profiles in provision/common.yaml')
    } else {
      report.ok(`profiles: ${profileKeys.join(', ')}`)
    }

    /** @type {string[]} */
    let toCheck = profileKeys
    if (opts.profile) {
      const want = String(opts.profile).trim()
      if (!meta.profiles[want]) {
        report.fail(`unknown profile ${want} (known: ${profileKeys.join(', ')})`)
        toCheck = []
      } else {
        toCheck = [want]
      }
    } else {
      try {
        const def = resolveProfile({ root })
        report.ok(`default profile: ${def.key} → ${def.env}/${def.target}`)
      } catch (err) {
        report.warn(err instanceof Error ? err.message : String(err))
      }
    }

    for (const key of toCheck) {
      const spec = meta.profiles[key]
      clearEnvProvisionCache()
      const r = await loadEnvProvisionSafe({
        profile: key,
        env: spec.env,
        target: spec.target,
      })
      if (r.ok) report.ok(`profile ${key} (${spec.env}/${spec.target}) loads`)
      else report.fail(`profile ${key}: ${r.error}`)
    }
  } catch (err) {
    report.fail(err instanceof Error ? err.message : String(err))
  } finally {
    clearEnvProvisionCache()
    process.chdir(prevCwd)
  }

  report.section('Env graphs')
  try {
    await loadEnvGraphForDir(root, { qctlEnv: 'dev', skipSensitive: true, skipCache: true })
    report.ok('root env graph (dev)')
  } catch (err) {
    report.fail(`root env graph: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    await loadEnvGraphForDir(join(root, 'provision'), {
      qctlEnv: 'dev',
      skipSensitive: true,
      skipCache: true,
    })
    report.ok('provision env graph (dev)')
  } catch (err) {
    report.fail(`provision env graph: ${err instanceof Error ? err.message : String(err)}`)
  }

  report.section('!env ↔ schema')
  const provisionDir = join(root, 'provision')
  const { refs, placeholders } = scanProvisionYaml(provisionDir)
  const schemaPath = join(provisionDir, '.env.schema')
  const schemaText = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : ''
  const schemaKeys = schemaKeySet(schemaText)

  for (const name of [...refs].sort()) {
    if (schemaKeys.has(name)) report.ok(`!env ${name} declared in .env.schema`)
    else report.fail(`!env ${name} missing from provision/.env.schema (try --sync-env-from-yaml)`)
  }
  for (const key of [...schemaKeys].sort()) {
    if (!refs.has(key)) report.warn(`schema key ${key} unused by provision YAML !env refs`)
  }

  report.section('Physical disk placeholders')
  if (placeholders.length === 0) {
    report.ok('no SET_PHYSICAL_DISK_ID_* leftovers')
  } else {
    for (const rel of placeholders) {
      report.fail(`${rel} still has SET_PHYSICAL_DISK_ID_* (bind real disk ids)`)
    }
  }

  report.section('Optional tooling')
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = /** @type {{ dependencies?: Record<string, string> }} */ (
        JSON.parse(readFileSync(pkgPath, 'utf8'))
      )
      const deps = pkg.dependencies ?? {}
      if (Object.keys(deps).length > 0 && !existsSync(join(root, 'package-lock.json'))) {
        report.warn('package.json has dependencies but package-lock.json is missing')
      } else if (Object.keys(deps).length > 0) {
        report.ok('package-lock.json present')
      } else {
        report.ok('no package.json dependencies to lock')
      }
    } catch {
      report.warn('package.json is not valid JSON')
    }
  }
  const misePath = join(root, 'mise.toml')
  if (existsSync(misePath)) {
    const mise = readFileSync(misePath, 'utf8')
    if (/\[tools\]/.test(mise) && /github:qraynaud\/qctl|qctl-host/.test(mise)) {
      report.ok('mise.toml pins qctl host tool')
    } else if (/\[tools\]/.test(mise)) {
      report.warn('mise.toml has [tools] but no qctl host pin (github:qraynaud/qctl)')
    } else {
      report.warn('mise.toml missing [tools] pin for qctl')
    }
  }

  report.section('Next')
  report.ok('host hypervisor probes: qctl vm target-check -p <profile> (not part of init --check)')

  return report.finish()
}
