/**
 * Custom init — §H secret values (fill gaps) + optional schema sync from !env refs.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'

import { collectEnvRefs, parseProvisionYaml } from '@qctl/shared'

import { asBindingPrompts, ensureEnvValue, ensureSchemaSecret } from '../../lib/binding.js'
import { wizardScoped, wizardStep } from './ui.js'
import { VAULTWARDEN_PLUGIN } from './varlock-plugins.js'

/** @import { BindingPrompts, CredentialBinding, EnvEncoding } from '../../lib/binding.js' */
/** @import { DisksWizardAnswers } from './disks.js' */
/** @import { OverlaysWizardAnswers } from './overlays.js' */
/** @import { PackagesFilesWizardAnswers } from './packages-files.js' */
/** @import { RepoRegWizardAnswers } from './repo-reg.js' */
/** @import { UsersSshWizardAnswers } from './users-ssh.js' */
/** @import { VarlockPluginDep } from './varlock-plugins.js' */

/**
 * @typedef {object} SecretSlot
 * @property {string} name
 * @property {EnvEncoding} encoding
 * @property {string} [value] From earlier askValueNow (may still need other envs)
 */

/**
 * Per-env values to write into `provision/.env.<env>`.
 * @typedef {object} SecretsWizardAnswers
 * @property {Record<string, Record<string, string>>} valuesByEnv env → name → value
 * @property {boolean} syncSchemaFromYaml
 */

/**
 * @param {CredentialBinding | null | undefined} binding
 * @param {Map<string, SecretSlot>} into
 */
function addBinding(binding, into) {
  if (binding?.kind !== 'secret') return
  const prev = into.get(binding.name)
  into.set(binding.name, {
    name: binding.name,
    encoding: binding.encoding ?? prev?.encoding ?? 'utf8',
    value: binding.value ?? prev?.value,
  })
}

/**
 * Collect unique secret slots from Custom wizard answers.
 * @param {{
 *   disks?: DisksWizardAnswers
 *   overlays?: OverlaysWizardAnswers
 *   usersSsh?: UsersSshWizardAnswers
 *   repoReg?: RepoRegWizardAnswers
 *   packagesFiles?: PackagesFilesWizardAnswers
 * }} answers
 * @returns {SecretSlot[]}
 */
export function collectProjectSecrets(answers) {
  /** @type {Map<string, SecretSlot>} */
  const map = new Map()

  if (answers.disks?.topology?.tanks) {
    for (const tank of Object.values(answers.disks.topology.tanks)) {
      addBinding(tank.passphrase, map)
    }
  }
  if (answers.disks?.byProfile) {
    for (const disks of Object.values(answers.disks.byProfile)) {
      for (const tank of Object.values(disks.tanks ?? {})) {
        addBinding(tank.passphrase, map)
      }
    }
  }

  if (answers.overlays?.proxmox) {
    addBinding(answers.overlays.proxmox.apiToken, map)
  }

  if (answers.usersSsh?.users) {
    addBinding(answers.usersSsh.users.admin.password, map)
  }
  if (answers.usersSsh) {
    addBinding(answers.usersSsh.hostKeys, map)
  }

  if (answers.repoReg?.repo) {
    addBinding(answers.repoReg.repo.branch, map)
    addBinding(answers.repoReg.repo.deployKey, map)
  }
  if (answers.repoReg?.registries) {
    for (const entry of answers.repoReg.registries) {
      addBinding(entry, map)
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   secrets: SecretSlot[]
 *   envKeys: string[]
 *   varlockPlugins?: VarlockPluginDep[]
 * }} opts
 * @returns {Promise<SecretsWizardAnswers | symbol>}
 */
export async function promptSecrets(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const { secrets, envKeys } = opts
  const hasVw = (opts.varlockPlugins ?? []).some((x) => x.package === VAULTWARDEN_PLUGIN)

  wizardStep(p, 'Secret values')

  /** @type {Record<string, Record<string, string>>} */
  const valuesByEnv = {}
  for (const env of envKeys) valuesByEnv[env] = {}

  const needsFill = secrets.filter((s) => s.value == null || s.value === '')
  const hasPreset = secrets.filter((s) => s.value != null && s.value !== '')

  // Copy values already captured during earlier steps into every env (baseline).
  for (const slot of hasPreset) {
    for (const env of envKeys) {
      valuesByEnv[env][slot.name] = /** @type {string} */ (slot.value)
    }
  }

  if (needsFill.length > 0) {
    for (const env of envKeys) {
      for (const slot of needsFill) {
        /** @type {{ value: string, label: string, hint?: string }[]} */
        const options = [
          { value: 'skip', label: 'Leave empty for now' },
          { value: 'literal', label: 'Set literal value' },
          { value: 'varlock', label: 'varlock(prompt)', hint: 'prompt at load time' },
        ]
        if (hasVw) {
          options.push({
            value: 'vw',
            label: 'vw("Item")',
            hint: 'Vaultwarden / Bitwarden item',
          })
        }

        const how = await p.select({
          message: wizardScoped({ env }, `${slot.name}`),
          options,
          initialValue: 'literal',
        })
        if (p.isCancel(how)) return /** @type {symbol} */ (how)

        if (how === 'skip') {
          valuesByEnv[env][slot.name] = ''
          continue
        }
        if (how === 'varlock') {
          valuesByEnv[env][slot.name] = 'varlock(prompt)'
          continue
        }
        if (how === 'vw') {
          const item = await p.text({
            message: wizardScoped({ env }, `Vaultwarden item name for ${slot.name}`),
            validate: (v) => (String(v ?? '').trim() ? undefined : 'Item name required'),
          })
          if (p.isCancel(item)) return /** @type {symbol} */ (item)
          const itemName = String(item).trim().replaceAll('"', '\\"')
          valuesByEnv[env][slot.name] = `vw("${itemName}")`
          continue
        }

        const value = await p.text({
          message: wizardScoped({ env }, `${slot.name}=`),
          initialValue: '',
        })
        if (p.isCancel(value)) return /** @type {symbol} */ (value)
        valuesByEnv[env][slot.name] = String(value ?? '')
      }
    }
  } else if (secrets.length > 0) {
    // All secrets already have values from earlier steps — still allow per-env override.
    const tweak = await p.confirm({
      message: 'Override secret values per environment?',
      initialValue: false,
    })
    if (p.isCancel(tweak)) return /** @type {symbol} */ (tweak)
    if (tweak) {
      for (const env of envKeys) {
        for (const slot of secrets) {
          const value = await p.text({
            message: wizardScoped({ env }, `${slot.name}=`),
            initialValue: valuesByEnv[env][slot.name] ?? slot.value ?? '',
          })
          if (p.isCancel(value)) return /** @type {symbol} */ (value)
          valuesByEnv[env][slot.name] = String(value ?? '')
        }
      }
    }
  }

  const syncSchemaFromYaml = await p.confirm({
    message: 'Sync provision/.env.schema from !env refs in YAML? (add-only)',
    initialValue: true,
  })
  if (p.isCancel(syncSchemaFromYaml)) return /** @type {symbol} */ (syncSchemaFromYaml)

  return {
    valuesByEnv,
    syncSchemaFromYaml: Boolean(syncSchemaFromYaml),
  }
}

/**
 * Ensure schema declares every `!env` name found under provision/*.yaml (add-only).
 * @param {string} root
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ refs: string[], added: string[] }}
 */
export function syncSchemaFromProvisionYaml(root, opts = {}) {
  const provisionDir = join(root, 'provision')
  if (!existsSync(provisionDir)) return { refs: [], added: [] }

  /** @type {Set<string>} */
  const refs = new Set()
  for (const name of readdirSync(provisionDir)) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    const text = readFileSync(join(provisionDir, name), 'utf8')
    try {
      const doc = parseProvisionYaml(text)
      for (const ref of collectEnvRefs(doc)) refs.add(ref)
    } catch {
      // Skip unreadable / partial YAML during init
    }
  }

  const schemaPath = join(provisionDir, '.env.schema')
  let schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '# ---\n'
  /** @type {string[]} */
  const names = [...refs].sort()
  /** @type {string[]} */
  const added = []
  for (const n of names) {
    const next = ensureSchemaSecret(schema, n)
    if (next.changed) added.push(n)
    schema = next.text
  }
  if (!opts.dryRun) {
    writeFileSync(schemaPath, schema.endsWith('\n') ? schema : `${schema}\n`, 'utf8')
  }
  return { refs: names, added }
}

/**
 * @param {string} root
 * @param {SecretsWizardAnswers} answers
 * @param {SecretSlot[]} [slots] ensure schema for known slots even before YAML sync
 */
export function applySecretsAnswers(root, answers, slots = []) {
  const provisionDir = join(root, 'provision')
  const schemaPath = join(provisionDir, '.env.schema')
  let schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '# ---\n'

  /** @type {Set<string>} */
  const names = new Set(slots.map((s) => s.name))
  for (const byName of Object.values(answers.valuesByEnv)) {
    for (const n of Object.keys(byName)) names.add(n)
  }
  for (const n of names) {
    schema = ensureSchemaSecret(schema, n).text
  }
  writeFileSync(schemaPath, schema.endsWith('\n') ? schema : `${schema}\n`, 'utf8')

  for (const [env, byName] of Object.entries(answers.valuesByEnv)) {
    const envPath = join(provisionDir, `.env.${env}`)
    let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : `# QCTL_ENV=${env}\n# ---\n`
    for (const [name, value] of Object.entries(byName)) {
      envText = ensureEnvValue(envText, name, value).text
    }
    writeFileSync(envPath, envText.endsWith('\n') ? envText : `${envText}\n`, 'utf8')
  }

  if (answers.syncSchemaFromYaml) {
    syncSchemaFromProvisionYaml(root)
  }
}
