/**
 * Custom init — optional guest repo clone + registries.
 * Written to common.yaml when shareTopology, else each env-*.yaml.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { provisionEnvFile } from '@qctl/shared'

import {
  asBindingPrompts,
  ensureEnvValue,
  ensureSchemaSecret,
  formatYamlValue,
  promptCredentialBinding,
} from '../../lib/binding.js'
import { hostCloneContext } from '../detect-clone-url.js'
import { wizardStep } from './ui.js'

/** @import { BindingPrompts, CredentialBinding } from '../../lib/binding.js' */
/**
 * @import {
 *   ProvisionFileInput,
 *   RegistriesInput,
 *   RepoInput,
 * } from '../../provision/schema/types.js'
 */
/** @import { EnvironmentWriteSpec, ProfileWriteSpec } from '../write-provision.js' */

const BRANCH_MARKER = '__REPO_BRANCH__'
const DEPLOY_KEY_MARKER = '__DEPLOY_KEY__'
const REG_MARKER_PREFIX = '__REG__'

/**
 * @typedef {object} RepoAnswers
 * @property {'git' | 'hg'} vcs
 * @property {string} url
 * @property {string} dir
 * @property {CredentialBinding} branch
 * @property {CredentialBinding} deployKey
 */

/**
 * One registries[] entry: static `registry|user|token` or secret !env.
 * @typedef {Extract<CredentialBinding, { kind: 'static' } | { kind: 'secret' }>} RegistryEntry
 */

/**
 * @typedef {object} RepoRegWizardAnswers
 * @property {boolean} shared
 * @property {RepoAnswers | null} repo null → omit `repo:`
 * @property {RegistryEntry[]} registries
 */

/**
 * @param {boolean} [shared]
 * @returns {RepoRegWizardAnswers}
 */
export function defaultRepoRegAnswers(shared = false) {
  return { shared, repo: null, registries: [] }
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
export function validateRegistryStaticLine(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'registry|user|token required'
  const parts = t.split('|')
  if (parts.length !== 3 || parts.some((p) => !p.trim())) {
    return 'Must be registry|username|token'
  }
  return undefined
}

/**
 * @param {RepoAnswers} repo
 * @returns {RepoInput}
 */
export function repoToPlain(repo) {
  /** @type {RepoInput} */
  const out = {
    vcs: repo.vcs,
    url: repo.url,
    dir: repo.dir,
  }
  if (repo.branch.kind === 'static') out.branch = BRANCH_MARKER
  else if (repo.branch.kind === 'secret') out.branch = BRANCH_MARKER

  if (repo.deployKey.kind === 'static' || repo.deployKey.kind === 'secret') {
    out.deploy_key = DEPLOY_KEY_MARKER
  }
  return out
}

/**
 * @param {RegistryEntry[]} registries
 * @returns {RegistriesInput}
 */
export function registriesToPlain(registries) {
  return registries.map((entry, i) => {
    if (entry.kind === 'static') return entry.value
    return `${REG_MARKER_PREFIX}${i}__`
  })
}

/**
 * @param {BindingPrompts} p
 * @param {string} root
 * @returns {Promise<RepoAnswers | symbol>}
 */
async function promptRepo(p, root) {
  const host = hostCloneContext(root)
  const vcs = await p.select({
    message: 'Guest clone VCS',
    options: [
      { value: 'git', label: 'Git' },
      { value: 'hg', label: 'Mercurial (hg)' },
    ],
    initialValue: host.vcs ?? 'git',
  })
  if (p.isCancel(vcs)) return /** @type {symbol} */ (vcs)
  const vcsKey = /** @type {'git' | 'hg'} */ (vcs)

  const suggestedUrl = host[vcsKey] ?? ''
  const url = await p.text({
    message: 'Clone URL',
    initialValue: suggestedUrl,
    validate: (v) => (v && String(v).trim() ? undefined : 'URL required'),
  })
  if (p.isCancel(url)) return /** @type {symbol} */ (url)

  const dir = await p.text({
    message: 'Guest clone directory',
    initialValue: '/tank/rocky',
    validate: (v) => (v && String(v).trim() ? undefined : 'Directory required'),
  })
  if (p.isCancel(dir)) return /** @type {symbol} */ (dir)

  const branch = await promptCredentialBinding({
    message: 'Clone branch',
    prompts: p,
    allowOmit: true,
    omitLabel: 'Omit (default branch)',
    initialKind: 'omit',
    suggestSecretName: 'REPO_BRANCH',
    askEncoding: false,
    askValueNow: true,
  })
  if (typeof branch === 'symbol') return branch

  const deployKey = await promptCredentialBinding({
    message: 'Deploy private key',
    prompts: p,
    allowOmit: true,
    omitLabel: 'Omit (no deploy key)',
    initialKind: 'secret',
    suggestSecretName: 'DEPLOY_KEY',
    askEncoding: true,
    askValueNow: true,
  })
  if (typeof deployKey === 'symbol') return deployKey

  return {
    vcs: vcsKey,
    url: String(url).trim(),
    dir: String(dir).trim(),
    branch,
    deployKey,
  }
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<RegistryEntry[] | symbol>}
 */
async function promptRegistries(p) {
  /** @type {RegistryEntry[]} */
  const registries = []
  const want = await p.confirm({
    message: 'Add container registries (podman login lines)?',
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return registries

  let more = true
  while (more) {
    const kind = await p.select({
      message: 'Registry entry',
      options: [
        { value: 'static', label: 'Static (registry|user|token)' },
        { value: 'secret', label: 'Secret (!env name)' },
      ],
      initialValue: 'secret',
    })
    if (p.isCancel(kind)) return /** @type {symbol} */ (kind)

    if (kind === 'static') {
      const line = await p.text({
        message: 'registry|username|token',
        validate: validateRegistryStaticLine,
      })
      if (p.isCancel(line)) return /** @type {symbol} */ (line)
      registries.push({ kind: 'static', value: String(line).trim() })
    } else {
      const nameRaw = await p.text({
        message: 'Secret name (UPPER_SNAKE_CASE)',
        initialValue:
          registries.length === 0 ? 'HEPTAPOD_REGISTRY' : `REGISTRY_${registries.length + 1}`,
        validate: (v) => {
          const t = String(v ?? '').trim()
          if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(t)) {
            return 'Must be UPPER_SNAKE_CASE'
          }
          return undefined
        },
      })
      if (p.isCancel(nameRaw)) return /** @type {symbol} */ (nameRaw)
      const name = String(nameRaw).trim()
      const setNow = await p.confirm({
        message: `Set ${name} value now for this env?`,
        initialValue: true,
      })
      if (p.isCancel(setNow)) return /** @type {symbol} */ (setNow)
      /** @type {RegistryEntry} */
      const entry = { kind: 'secret', name, encoding: 'utf8' }
      if (setNow) {
        const value = await p.text({
          message: `${name}= (registry|user|token)`,
          validate: validateRegistryStaticLine,
        })
        if (p.isCancel(value)) return /** @type {symbol} */ (value)
        entry.value = String(value).trim()
      }
      registries.push(entry)
    }

    const again = await p.confirm({
      message: 'Add another registry?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
  return registries
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   root: string
 *   shareTopology: boolean
 * }} opts
 * @returns {Promise<RepoRegWizardAnswers | symbol>}
 */
export async function promptRepoReg(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)

  wizardStep(p, 'Repo & registries')

  const wantRepo = await p.confirm({
    message:
      'Clone a git/hg repo on the guest at first boot? (No → use qctl sync from this machine)',
    initialValue: false,
  })
  if (p.isCancel(wantRepo)) return /** @type {symbol} */ (wantRepo)

  /** @type {RepoAnswers | null} */
  let repo = null
  if (wantRepo) {
    const block = await promptRepo(p, opts.root)
    if (typeof block === 'symbol') return block
    repo = block
  }

  const registries = await promptRegistries(p)
  if (typeof registries === 'symbol') return registries

  return {
    shared: Boolean(opts.shareTopology),
    repo,
    registries,
  }
}

/** @typedef {Partial<ProvisionFileInput>} ProvisionYamlDoc */

/**
 * @param {string} path
 * @param {{ repo?: RepoInput, registries?: RegistriesInput }} block
 * @param {{
 *   branch?: CredentialBinding
 *   deployKey?: CredentialBinding
 *   registries?: RegistryEntry[]
 * }} bindings
 */
function writeRepoRegIntoYamlFile(path, block, bindings = {}) {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const commentMatch = before.match(/^(?:#[^\n]*\n)*/)
  const header = commentMatch?.[0] ?? ''
  const body = before.slice(header.length)
  /** @type {ProvisionYamlDoc} */
  let doc
  try {
    doc = /** @type {ProvisionYamlDoc} */ (YAML.parse(body) ?? {})
  } catch {
    doc = {}
  }
  if (block.repo) doc.repo = block.repo
  if (block.registries?.length) doc.registries = block.registries

  let text = header + YAML.stringify(doc, { lineWidth: 100 })
  /** @param {string} marker @param {CredentialBinding | undefined} binding */
  const inject = (marker, binding) => {
    if (!binding || binding.kind === 'omit') return
    if (binding.kind !== 'secret' && binding.kind !== 'static') return
    const value = formatYamlValue(binding)
    text = text.replaceAll(`'${marker}'`, value).replaceAll(`"${marker}"`, value)
    text = text.replaceAll(marker, value)
  }
  inject(BRANCH_MARKER, bindings.branch)
  inject(DEPLOY_KEY_MARKER, bindings.deployKey)
  for (const [i, entry] of (bindings.registries ?? []).entries()) {
    if (entry.kind !== 'secret') continue
    inject(`${REG_MARKER_PREFIX}${i}__`, entry)
  }
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/**
 * @param {string} root
 * @param {CredentialBinding[]} secrets
 * @param {string[]} envs
 */
function applySecrets(root, secrets, envs) {
  const schemaPath = join(root, 'provision', '.env.schema')
  let schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '# ---\n'
  for (const binding of secrets) {
    if (binding.kind !== 'secret') continue
    schema = ensureSchemaSecret(schema, binding.name).text
  }
  writeFileSync(schemaPath, schema.endsWith('\n') ? schema : `${schema}\n`, 'utf8')

  for (const env of envs) {
    const envPath = join(root, 'provision', `.env.${env}`)
    let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : `# QCTL_ENV=${env}\n# ---\n`
    for (const binding of secrets) {
      if (binding.kind !== 'secret') continue
      envText = ensureEnvValue(envText, binding.name, binding.value ?? '').text
    }
    writeFileSync(envPath, envText.endsWith('\n') ? envText : `${envText}\n`, 'utf8')
  }
}

/**
 * @param {string} root
 * @param {RepoRegWizardAnswers} answers
 * @param {{
 *   profiles: Record<string, ProfileWriteSpec>
 *   environments: Record<string, EnvironmentWriteSpec>
 * }} ctx
 */
export function applyRepoRegAnswers(root, answers, ctx) {
  /** @type {{ repo?: RepoInput, registries?: RegistriesInput }} */
  const block = {}
  if (answers.repo) block.repo = repoToPlain(answers.repo)
  if (answers.registries.length) block.registries = registriesToPlain(answers.registries)

  if (!block.repo && !block.registries) return

  const provisionDir = join(root, 'provision')
  /** @type {string[]} */
  const paths = []

  if (answers.shared) {
    const commonPath = join(provisionDir, 'common.yaml')
    if (!existsSync(commonPath)) {
      writeFileSync(commonPath, `# Shared provision settings for every profile.\n`, 'utf8')
    }
    paths.push(commonPath)
  } else {
    /** @type {Set<string>} */
    const envs = new Set()
    for (const spec of Object.values(ctx.profiles)) envs.add(spec.env)
    for (const env of Object.keys(ctx.environments)) envs.add(env)
    for (const env of envs) {
      const path = join(provisionDir, provisionEnvFile(env))
      if (!existsSync(path)) {
        writeFileSync(path, `# Env "${env}".\n`, 'utf8')
      }
      paths.push(path)
    }
  }

  const bindings = {
    branch: answers.repo?.branch,
    deployKey: answers.repo?.deployKey,
    registries: answers.registries,
  }
  for (const path of paths) {
    writeRepoRegIntoYamlFile(path, block, bindings)
  }

  /** @type {CredentialBinding[]} */
  const secrets = []
  if (answers.repo?.branch.kind === 'secret') secrets.push(answers.repo.branch)
  if (answers.repo?.deployKey.kind === 'secret') secrets.push(answers.repo.deployKey)
  for (const entry of answers.registries) {
    if (entry.kind === 'secret') secrets.push(entry)
  }
  if (secrets.length) {
    /** @type {Set<string>} */
    const envs = new Set()
    for (const spec of Object.values(ctx.profiles)) envs.add(spec.env)
    for (const env of Object.keys(ctx.environments)) envs.add(env)
    applySecrets(root, secrets, [...envs])
  }
}
