/**
 * Custom init — users + SSH (optional users block; authorized_keys; host_keys).
 * Written to common.yaml when shareTopology, else each env-*.yaml.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
import {
  DEFAULT_ADMIN_UID,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_APPS_UID,
  DEFAULT_APPS_USERNAME,
  defaultAppsSubidRange,
  formatSubuid,
} from '../../provision/schema/users.js'
import { wizardStep } from './ui.js'

/** @import { BindingPrompts, CredentialBinding } from '../../lib/binding.js' */
/**
 * @import {
 *   ProvisionFileInput,
 *   SshInput,
 *   UsersInput,
 *   UsersPlain,
 * } from '../../provision/schema/types.js'
 */
/** @import { EnvironmentWriteSpec, ProfileWriteSpec } from '../write-provision.js' */

const PASSWORD_MARKER = '__ADMIN_PASSWORD__'
const HOST_KEYS_MARKER = '__HOST_KEYS__'
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/i
const RESERVED = new Set(['root', 'nobody', 'dbus'])

/**
 * @typedef {object} AdminUserAnswers
 * @property {string} username
 * @property {number} [uid]
 * @property {number} [gid]
 * @property {CredentialBinding} password
 */

/**
 * @typedef {object} AppsUserAnswers
 * @property {string} username
 * @property {number} [uid]
 * @property {number} [gid]
 * @property {string} [subuid] `start:count`
 * @property {string} [subgid]
 */

/**
 * @typedef {object} UsersSshWizardAnswers
 * @property {boolean} shared Write to common.yaml when true
 * @property {{ admin: AdminUserAnswers, apps: AppsUserAnswers } | null} users
 *   null → omit `users:` (schema defaults)
 * @property {string[] | null} authorizedKeys null → omit (host ~/.ssh fallback)
 * @property {CredentialBinding} hostKeys omit | secret (static rare)
 */

/**
 * @param {boolean} [shared]
 * @returns {UsersSshWizardAnswers}
 */
export function defaultUsersSshAnswers(shared = false) {
  return {
    shared,
    users: null,
    authorizedKeys: null,
    hostKeys: { kind: 'omit' },
  }
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateUsername(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'Username required'
  if (!USERNAME_RE.test(t)) return 'Must be a short POSIX name'
  if (RESERVED.has(t.toLowerCase()) || t.toLowerCase().startsWith('systemd-')) {
    return 'Username is reserved'
  }
  return undefined
}

/**
 * @param {string | undefined} raw
 * @param {boolean} [required]
 * @returns {string | undefined}
 */
function validateOptionalUid(raw, required = false) {
  const t = String(raw ?? '').trim()
  if (!t) return required ? 'UID required' : undefined
  const n = Number(t)
  if (!Number.isInteger(n) || n < 0) return 'Must be a non-negative integer'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalSubuid(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  if (!/^\d+:\d+$/.test(t)) return 'Must be start:count (e.g. 900000:32768)'
  const count = Number(t.split(':')[1])
  if (count < 1 || count > 32768) return 'Count must be 1–32768'
  return undefined
}

/**
 * Expand `~/…` and read if path exists; otherwise treat as key material.
 * @param {string} raw
 * @returns {string[]}
 */
export function resolveAuthorizedKeyInput(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return []
  let path = t
  if (t.startsWith('~/')) path = join(homedir(), t.slice(2))
  else if (t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)) path = t
  else path = ''

  if (path && existsSync(path)) {
    const text = readFileSync(path, 'utf8')
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  }
  // Multiline paste or single key line
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/**
 * Writer plain for `users:` (password may be marker).
 * @param {{ admin: AdminUserAnswers, apps: AppsUserAnswers }} users
 * @returns {UsersPlain}
 */
export function usersToPlain(users) {
  /** @type {UsersPlain['admin']} */
  const admin = { username: users.admin.username }
  if (users.admin.uid != null) admin.uid = users.admin.uid
  if (users.admin.gid != null) admin.gid = users.admin.gid
  if (users.admin.password.kind === 'static') {
    admin.password = users.admin.password.value
  } else if (users.admin.password.kind === 'secret') {
    admin.password = PASSWORD_MARKER
  }

  /** @type {UsersPlain['apps']} */
  const apps = { username: users.apps.username }
  if (users.apps.uid != null) apps.uid = users.apps.uid
  if (users.apps.gid != null) apps.gid = users.apps.gid
  if (users.apps.subuid) apps.subuid = users.apps.subuid
  if (users.apps.subgid) apps.subgid = users.apps.subgid

  return { admin, apps }
}

/**
 * Writer plain for `ssh:` (host_keys may be marker). null if nothing to write.
 * @param {UsersSshWizardAnswers} answers
 * @returns {SshInput | null}
 */
export function sshToPlain(answers) {
  /** @type {SshInput} */
  const ssh = {}
  if (answers.authorizedKeys?.length) {
    ssh.authorized_keys =
      answers.authorizedKeys.length === 1 ? answers.authorizedKeys[0] : [...answers.authorizedKeys]
  }
  if (answers.hostKeys.kind === 'secret') {
    ssh.host_keys = HOST_KEYS_MARKER
  } else if (answers.hostKeys.kind === 'static') {
    ssh.host_keys = answers.hostKeys.value
  }
  return Object.keys(ssh).length ? ssh : null
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<{ admin: AdminUserAnswers, apps: AppsUserAnswers } | symbol>}
 */
async function promptUsersBlock(p) {
  const adminUser = await p.text({
    message: 'Admin username',
    initialValue: DEFAULT_ADMIN_USERNAME,
    validate: validateUsername,
  })
  if (p.isCancel(adminUser)) return /** @type {symbol} */ (adminUser)

  const adminUidRaw = await p.text({
    message: 'Admin uid (empty = 1000)',
    initialValue: String(DEFAULT_ADMIN_UID),
    validate: (v) => validateOptionalUid(v),
  })
  if (p.isCancel(adminUidRaw)) return /** @type {symbol} */ (adminUidRaw)

  const adminGidRaw = await p.text({
    message: 'Admin gid (empty = same as uid)',
    placeholder: 'same as uid',
    validate: (v) => validateOptionalUid(v),
  })
  if (p.isCancel(adminGidRaw)) return /** @type {symbol} */ (adminGidRaw)

  const password = await promptCredentialBinding({
    message: 'Admin password',
    prompts: p,
    allowOmit: true,
    omitLabel: 'Omit (SSH key-only / passwd later)',
    initialKind: 'omit',
    suggestSecretName: 'ADMIN_PASSWORD',
    askValueNow: true,
  })
  if (typeof password === 'symbol') return password

  const appsUser = await p.text({
    message: 'Apps username',
    initialValue: DEFAULT_APPS_USERNAME,
    validate: (v) => {
      const err = validateUsername(v)
      if (err) return err
      if (String(v).trim() === String(adminUser).trim()) {
        return 'Must differ from admin username'
      }
      return undefined
    },
  })
  if (p.isCancel(appsUser)) return /** @type {symbol} */ (appsUser)

  const appsUidRaw = await p.text({
    message: 'Apps uid (empty = 900)',
    initialValue: String(DEFAULT_APPS_UID),
    validate: (v) => validateOptionalUid(v),
  })
  if (p.isCancel(appsUidRaw)) return /** @type {symbol} */ (appsUidRaw)

  const appsGidRaw = await p.text({
    message: 'Apps gid (empty = same as uid)',
    placeholder: 'same as uid',
    validate: (v) => validateOptionalUid(v),
  })
  if (p.isCancel(appsGidRaw)) return /** @type {symbol} */ (appsGidRaw)

  const customSub = await p.confirm({
    message: 'Customize apps subuid/subgid?',
    initialValue: false,
  })
  if (p.isCancel(customSub)) return /** @type {symbol} */ (customSub)

  /** @type {string | undefined} */
  let subuid
  /** @type {string | undefined} */
  let subgid
  if (customSub) {
    const appsUidNum = String(appsUidRaw).trim()
      ? Number(String(appsUidRaw).trim())
      : DEFAULT_APPS_UID
    const def = formatSubuid(defaultAppsSubidRange(appsUidNum))
    const subuidRaw = await p.text({
      message: 'Apps subuid (start:count)',
      initialValue: def,
      validate: (v) => {
        const t = String(v ?? '').trim()
        if (!t) return 'subuid required'
        return validateOptionalSubuid(t)
      },
    })
    if (p.isCancel(subuidRaw)) return /** @type {symbol} */ (subuidRaw)
    subuid = String(subuidRaw).trim()

    const subgidRaw = await p.text({
      message: 'Apps subgid (start:count)',
      initialValue: subuid,
      validate: (v) => {
        const t = String(v ?? '').trim()
        if (!t) return 'subgid required'
        return validateOptionalSubuid(t)
      },
    })
    if (p.isCancel(subgidRaw)) return /** @type {symbol} */ (subgidRaw)
    subgid = String(subgidRaw).trim()
  }

  /** @type {AdminUserAnswers} */
  const admin = {
    username: String(adminUser).trim(),
    password,
  }
  const au = String(adminUidRaw).trim()
  if (au) admin.uid = Number(au)
  const ag = String(adminGidRaw).trim()
  if (ag) admin.gid = Number(ag)

  /** @type {AppsUserAnswers} */
  const apps = {
    username: String(appsUser).trim(),
  }
  const apu = String(appsUidRaw).trim()
  if (apu) apps.uid = Number(apu)
  const apg = String(appsGidRaw).trim()
  if (apg) apps.gid = Number(apg)
  if (subuid) apps.subuid = subuid
  if (subgid) apps.subgid = subgid

  return { admin, apps }
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<string[] | null | symbol>}
 */
async function promptAuthorizedKeys(p) {
  const useFallback = await p.confirm({
    message: 'Use pubkeys from ~/.ssh/*.pub for the admin user?',
    initialValue: true,
  })
  if (p.isCancel(useFallback)) return /** @type {symbol} */ (useFallback)
  if (useFallback) return null

  /** @type {string[]} */
  const keys = []
  let more = true
  while (more) {
    const raw = await p.text({
      message: keys.length
        ? 'Next SSH public key (paste, or path to .pub file)'
        : 'Admin SSH public key (paste, or path to .pub file)',
      validate: (v) => {
        const resolved = resolveAuthorizedKeyInput(String(v ?? ''))
        return resolved.length ? undefined : 'Paste a key or path to a .pub file'
      },
    })
    if (p.isCancel(raw)) return /** @type {symbol} */ (raw)
    keys.push(...resolveAuthorizedKeyInput(String(raw)))

    const again = await p.confirm({
      message: 'Add another authorized key?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
  return keys
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   shareTopology: boolean
 * }} opts
 * @returns {Promise<UsersSshWizardAnswers | symbol>}
 */
export async function promptUsersSsh(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)

  wizardStep(p, 'Users & SSH')

  const customize = await p.confirm({
    message: 'Customize users? (No = defaults admin/1000, apps/900+subids)',
    initialValue: false,
  })
  if (p.isCancel(customize)) return /** @type {symbol} */ (customize)

  /** @type {{ admin: AdminUserAnswers, apps: AppsUserAnswers } | null} */
  let users = null
  if (customize) {
    const block = await promptUsersBlock(p)
    if (typeof block === 'symbol') return block
    users = block
  }

  const authorizedKeys = await promptAuthorizedKeys(p)
  if (typeof authorizedKeys === 'symbol') return authorizedKeys

  const hostKeys = await promptCredentialBinding({
    message: 'SSH host keys tarball (gzip of /etc/ssh/ssh_host_*)',
    prompts: p,
    allowOmit: true,
    omitLabel: 'Omit (guest generates host keys)',
    initialKind: 'omit',
    suggestSecretName: 'SSH_HOST_KEYS',
    askEncoding: true,
    askValueNow: true,
  })
  if (typeof hostKeys === 'symbol') return hostKeys

  return {
    shared: Boolean(opts.shareTopology),
    users,
    authorizedKeys,
    hostKeys,
  }
}

/** @typedef {Partial<ProvisionFileInput>} ProvisionYamlDoc */

/**
 * @param {string} path
 * @param {{ users?: UsersPlain, ssh?: SshInput }} block
 * @param {{ password?: CredentialBinding, hostKeys?: CredentialBinding }} bindings
 */
function writeUsersSshIntoYamlFile(path, block, bindings = {}) {
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
  if (block.users) doc.users = block.users
  if (block.ssh) doc.ssh = block.ssh

  let text = header + YAML.stringify(doc, { lineWidth: 100 })
  /** @param {string} marker @param {CredentialBinding | undefined} binding */
  const inject = (marker, binding) => {
    if (!binding || binding.kind === 'omit') return
    if (binding.kind !== 'secret' && binding.kind !== 'static') return
    const value = formatYamlValue(binding)
    text = text.replaceAll(`'${marker}'`, value).replaceAll(`"${marker}"`, value)
    text = text.replaceAll(marker, value)
  }
  inject(PASSWORD_MARKER, bindings.password)
  inject(HOST_KEYS_MARKER, bindings.hostKeys)
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
      if (binding.value != null) {
        envText = ensureEnvValue(envText, binding.name, binding.value).text
      } else {
        envText = ensureEnvValue(envText, binding.name, '').text
      }
    }
    writeFileSync(envPath, envText.endsWith('\n') ? envText : `${envText}\n`, 'utf8')
  }
}

/**
 * @param {string} root
 * @param {UsersSshWizardAnswers} answers
 * @param {{
 *   profiles: Record<string, ProfileWriteSpec>
 *   environments: Record<string, EnvironmentWriteSpec>
 * }} ctx
 */
export function applyUsersSshAnswers(root, answers, ctx) {
  /** @type {{ users?: UsersPlain, ssh?: SshInput }} */
  const block = {}
  if (answers.users) block.users = usersToPlain(answers.users)
  const ssh = sshToPlain(answers)
  if (ssh) block.ssh = ssh

  if (!block.users && !block.ssh) return

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
    password: answers.users?.admin.password,
    hostKeys: answers.hostKeys,
  }
  for (const path of paths) {
    writeUsersSshIntoYamlFile(path, block, bindings)
  }

  /** @type {CredentialBinding[]} */
  const secrets = []
  if (answers.users?.admin.password.kind === 'secret') {
    secrets.push(answers.users.admin.password)
  }
  if (answers.hostKeys.kind === 'secret') secrets.push(answers.hostKeys)

  if (secrets.length) {
    /** @type {Set<string>} */
    const envs = new Set()
    for (const spec of Object.values(ctx.profiles)) envs.add(spec.env)
    for (const env of Object.keys(ctx.environments)) envs.add(env)
    applySecrets(root, secrets, [...envs])
  }
}
