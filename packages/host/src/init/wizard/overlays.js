/**
 * Custom init — hypervisor target overlays (workstation / proxmox).
 * One prompt pass per unique target → `provision/target-*.yaml`.
 * Host NIC attach lives on `networking.interfaces.*.vm` (not proxmox.*).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { provisionTargetFile } from '@qctl/shared'

import {
  asBindingPrompts,
  ensureEnvValue,
  ensureSchemaSecret,
  formatYamlValue,
  promptCredentialBinding,
} from '../../lib/binding.js'
import { IFACE_RE } from '../../provision/schema/zod-utils.js'
import { ethernetLabels } from './networking.js'
import { wizardScoped, wizardStep } from './ui.js'

/** @import { BindingPrompts, CredentialBinding } from '../../lib/binding.js' */
/**
 * @import {
 *   ProvisionFileInput,
 *   ProxmoxInput,
 *   WorkstationInput,
 * } from '../../provision/schema/types.js'
 */
/** @import { ProfileWriteSpec } from '../write-provision.js' */
/** @import { NetworkingTopology } from './networking.js' */

const API_TOKEN_MARKER = '__API_TOKEN__'

/**
 * @typedef {object} WorkstationOverlayAnswers
 * @property {number} cpu
 * @property {number} memory
 */

/**
 * @typedef {object} ProxmoxOverlayAnswers
 * @property {string} apiUrl
 * @property {string} node
 * @property {string} [storage]
 * @property {string} [imageStorage]
 * @property {number} [vmid]
 * @property {number} cpu
 * @property {number} memory
 * @property {CredentialBinding} apiToken
 */

/**
 * Guest iface remaps for a target file (`networking.interfaces.<label>.iface`).
 * @typedef {Record<string, string>} IfaceRemaps label → iface
 */

/**
 * @typedef {object} OverlaysWizardAnswers
 * @property {WorkstationOverlayAnswers} [workstation]
 * @property {ProxmoxOverlayAnswers} [proxmox]
 * @property {Record<string, IfaceRemaps>} [ifaceRemapsByTarget] target → label → iface
 */

/**
 * @returns {WorkstationOverlayAnswers}
 */
export function defaultWorkstationOverlay() {
  return { cpu: 2, memory: 4096 }
}

/**
 * @returns {ProxmoxOverlayAnswers}
 */
export function defaultProxmoxOverlay() {
  return {
    apiUrl: 'https://pve.example:8006',
    node: 'pve',
    cpu: 2,
    memory: 4096,
    apiToken: { kind: 'secret', name: 'PROXMOX_API_TOKEN', encoding: 'utf8' },
  }
}

/**
 * @param {WorkstationOverlayAnswers} ws
 * @returns {{ workstation: WorkstationInput }}
 */
export function workstationToPlain(ws) {
  return {
    workstation: {
      cpu: ws.cpu,
      memory: ws.memory,
    },
  }
}

/**
 * Plain proxmox block; api_token uses {@link API_TOKEN_MARKER} when secret.
 * @param {ProxmoxOverlayAnswers} pve
 * @returns {{ proxmox: ProxmoxInput }}
 */
export function proxmoxToPlain(pve) {
  /** @type {ProxmoxInput} */
  const proxmox = {
    api_url: pve.apiUrl,
    node: pve.node,
    cpu: pve.cpu,
    memory: pve.memory,
  }
  if (pve.storage) proxmox.storage = pve.storage
  if (pve.imageStorage) proxmox.image_storage = pve.imageStorage
  if (pve.vmid != null) proxmox.vmid = pve.vmid

  if (pve.apiToken.kind === 'static') {
    proxmox.api_token = pve.apiToken.value
  } else if (pve.apiToken.kind === 'secret') {
    proxmox.api_token = API_TOKEN_MARKER
  }
  // omit → no api_token key

  return { proxmox }
}

/**
 * @param {IfaceRemaps} remaps
 * @returns {NonNullable<ProvisionFileInput['networking']>}
 */
export function ifaceRemapsToPlain(remaps) {
  /** @type {NonNullable<NonNullable<ProvisionFileInput['networking']>['interfaces']>} */
  const interfaces = {}
  for (const [label, iface] of Object.entries(remaps)) {
    if (!iface) continue
    interfaces[label] = { iface }
  }
  return { interfaces }
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateCpu(raw) {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isInteger(n) || n < 1 || n > 256) return 'CPU must be an integer 1–256'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateMemory(raw) {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isInteger(n) || n < 256 || n > 1048576) {
    return 'Memory must be an integer MiB (256–1048576)'
  }
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalVmid(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  const n = Number(t)
  if (!Number.isInteger(n) || n < 100) return 'VMID must be an integer ≥ 100 (or empty)'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalIface(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  if (!IFACE_RE.test(t)) return 'Must be a Linux interface name (e.g. eth0, enp0s1)'
  return undefined
}

/**
 * @typedef {{ target?: string }} WizardScopeLike
 */

/**
 * @param {BindingPrompts} p
 * @param {WizardScopeLike} scope
 * @returns {Promise<WorkstationOverlayAnswers | symbol>}
 */
async function promptWorkstation(p, scope) {
  const cpuRaw = await p.text({
    message: wizardScoped(scope, 'vCPUs'),
    initialValue: '2',
    validate: validateCpu,
  })
  if (p.isCancel(cpuRaw)) return /** @type {symbol} */ (cpuRaw)

  const memRaw = await p.text({
    message: wizardScoped(scope, 'Memory (MiB)'),
    initialValue: '4096',
    validate: validateMemory,
  })
  if (p.isCancel(memRaw)) return /** @type {symbol} */ (memRaw)

  return {
    cpu: Number(String(cpuRaw).trim()),
    memory: Number(String(memRaw).trim()),
  }
}

/**
 * @param {BindingPrompts} p
 * @param {WizardScopeLike} scope
 * @returns {Promise<ProxmoxOverlayAnswers | symbol>}
 */
async function promptProxmox(p, scope) {
  const apiUrl = await p.text({
    message: wizardScoped(scope, 'Proxmox API URL'),
    initialValue: 'https://pve.example:8006',
    validate: (v) => (String(v ?? '').trim() ? undefined : 'API URL required'),
  })
  if (p.isCancel(apiUrl)) return /** @type {symbol} */ (apiUrl)

  const node = await p.text({
    message: wizardScoped(scope, 'Proxmox node name'),
    initialValue: 'pve',
    validate: (v) => (String(v ?? '').trim() ? undefined : 'Node required'),
  })
  if (p.isCancel(node)) return /** @type {symbol} */ (node)

  const storage = await p.text({
    message: wizardScoped(scope, 'Storage (empty = omit)'),
    placeholder: 'local-lvm',
  })
  if (p.isCancel(storage)) return /** @type {symbol} */ (storage)

  const imageStorage = await p.text({
    message: wizardScoped(scope, 'Image storage (empty = omit)'),
    placeholder: 'local',
  })
  if (p.isCancel(imageStorage)) return /** @type {symbol} */ (imageStorage)

  const vmidRaw = await p.text({
    message: wizardScoped(scope, 'VMID (empty = omit)'),
    placeholder: '120',
    validate: validateOptionalVmid,
  })
  if (p.isCancel(vmidRaw)) return /** @type {symbol} */ (vmidRaw)

  const cpuRaw = await p.text({
    message: wizardScoped(scope, 'vCPUs'),
    initialValue: '2',
    validate: validateCpu,
  })
  if (p.isCancel(cpuRaw)) return /** @type {symbol} */ (cpuRaw)

  const memRaw = await p.text({
    message: wizardScoped(scope, 'Memory (MiB)'),
    initialValue: '4096',
    validate: validateMemory,
  })
  if (p.isCancel(memRaw)) return /** @type {symbol} */ (memRaw)

  const apiToken = await promptCredentialBinding({
    message: wizardScoped(scope, 'Proxmox API token'),
    prompts: p,
    allowOmit: true,
    initialKind: 'secret',
    suggestSecretName: 'PROXMOX_API_TOKEN',
    askEncoding: false,
    askValueNow: true,
  })
  if (typeof apiToken === 'symbol') return apiToken

  /** @type {ProxmoxOverlayAnswers} */
  const out = {
    apiUrl: String(apiUrl).trim(),
    node: String(node).trim(),
    cpu: Number(String(cpuRaw).trim()),
    memory: Number(String(memRaw).trim()),
    apiToken,
  }
  const st = String(storage).trim()
  if (st) out.storage = st
  const ist = String(imageStorage).trim()
  if (ist) out.imageStorage = ist
  const vmidT = String(vmidRaw).trim()
  if (vmidT) out.vmid = Number(vmidT)
  return out
}

/**
 * Optional per-target guest iface remaps (written under networking.interfaces).
 * @param {BindingPrompts} p
 * @param {string} target
 * @param {string[]} etherLabels
 * @returns {Promise<IfaceRemaps | symbol | null>} null = skip
 */
async function promptIfaceRemaps(p, target, etherLabels) {
  if (etherLabels.length === 0) return null

  const want = await p.confirm({
    message: wizardScoped(
      { target },
      'Remap guest iface names in target YAML? (host attach stays on ethernet.vm)',
    ),
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return null

  /** @type {IfaceRemaps} */
  const remaps = {}
  for (const label of etherLabels) {
    const raw = await p.text({
      message: wizardScoped({ target }, `Guest iface for ${label} (empty = keep)`),
      placeholder: 'enp0s1',
      validate: validateOptionalIface,
    })
    if (p.isCancel(raw)) return /** @type {symbol} */ (raw)
    const t = String(raw).trim()
    if (t) remaps[label] = t
  }
  return Object.keys(remaps).length ? remaps : null
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   profiles: Record<string, ProfileWriteSpec>
 *   networking?: { topology: NetworkingTopology } | null
 * }} opts
 * @returns {Promise<OverlaysWizardAnswers | symbol>}
 */
export async function promptOverlays(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const { profiles } = opts
  const topology = opts.networking?.topology ?? null
  const etherLabels = topology ? ethernetLabels(topology) : []

  /** @type {Set<string>} */
  const targets = new Set()
  for (const spec of Object.values(profiles)) targets.add(spec.target)

  if (targets.size === 0) return {}

  wizardStep(p, 'Hypervisor overlays')

  /** @type {OverlaysWizardAnswers} */
  const answers = {}

  if (targets.has('workstation')) {
    const ws = await promptWorkstation(p, { target: 'workstation' })
    if (typeof ws === 'symbol') return ws
    answers.workstation = ws
  }

  if (targets.has('proxmox')) {
    const pve = await promptProxmox(p, { target: 'proxmox' })
    if (typeof pve === 'symbol') return pve
    answers.proxmox = pve
  }

  /** @type {Record<string, IfaceRemaps>} */
  const ifaceRemapsByTarget = {}
  for (const target of [...targets].sort((a, b) => a.localeCompare(b))) {
    const remaps = await promptIfaceRemaps(p, target, etherLabels)
    if (typeof remaps === 'symbol') return remaps
    if (remaps) ifaceRemapsByTarget[target] = remaps
  }
  if (Object.keys(ifaceRemapsByTarget).length) {
    answers.ifaceRemapsByTarget = ifaceRemapsByTarget
  }

  return answers
}

/** @typedef {Partial<ProvisionFileInput>} TargetYamlDoc */

/**
 * @param {string} path
 * @param {TargetYamlDoc} block
 * @param {CredentialBinding} [apiToken]
 */
function writeTargetYamlFile(path, block, apiToken) {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const commentMatch = before.match(/^(?:#[^\n]*\n)*/)
  const header = commentMatch?.[0] ?? ''
  const body = before.slice(header.length)
  /** @type {TargetYamlDoc} */
  let doc
  try {
    doc = /** @type {TargetYamlDoc} */ (YAML.parse(body) ?? {})
  } catch {
    doc = {}
  }
  Object.assign(doc, block)
  let text = header + YAML.stringify(doc, { lineWidth: 100 })
  if (apiToken && apiToken.kind === 'secret') {
    const value = formatYamlValue(apiToken)
    text = text
      .replaceAll(`'${API_TOKEN_MARKER}'`, value)
      .replaceAll(`"${API_TOKEN_MARKER}"`, value)
    text = text.replaceAll(API_TOKEN_MARKER, value)
  }
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/**
 * @param {string} root
 * @param {CredentialBinding} apiToken
 * @param {string[]} envs
 */
function applyApiTokenSecrets(root, apiToken, envs) {
  if (apiToken.kind !== 'secret') return
  const schemaPath = join(root, 'provision', '.env.schema')
  let schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '# ---\n'
  schema = ensureSchemaSecret(schema, apiToken.name).text
  writeFileSync(schemaPath, schema.endsWith('\n') ? schema : `${schema}\n`, 'utf8')

  for (const env of envs) {
    const envPath = join(root, 'provision', `.env.${env}`)
    let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : `# QCTL_ENV=${env}\n# ---\n`
    if (apiToken.value != null) {
      envText = ensureEnvValue(envText, apiToken.name, apiToken.value).text
    } else if (!envText.includes(`${apiToken.name}=`)) {
      // Ensure key exists as empty placeholder when value deferred
      envText = ensureEnvValue(envText, apiToken.name, '').text
    }
    writeFileSync(envPath, envText.endsWith('\n') ? envText : `${envText}\n`, 'utf8')
  }
}

/**
 * Merge iface remaps into an existing target YAML write block.
 * @param {string} path
 * @param {IfaceRemaps} remaps
 * @param {TargetYamlDoc} [block]
 * @param {CredentialBinding} [apiToken]
 */
function writeTargetWithRemaps(path, remaps, block = {}, apiToken) {
  const networking = ifaceRemapsToPlain(remaps)
  writeTargetYamlFile(path, { ...block, networking }, apiToken)
}

/**
 * Write target overlays into `provision/target-*.yaml` (+ api_token secrets).
 * @param {string} root
 * @param {OverlaysWizardAnswers} answers
 * @param {{
 *   profiles: Record<string, ProfileWriteSpec>
 * }} ctx
 */
export function applyOverlaysAnswers(root, answers, ctx) {
  const provisionDir = join(root, 'provision')
  const remapsByTarget = answers.ifaceRemapsByTarget ?? {}

  if (answers.workstation) {
    const path = join(provisionDir, provisionTargetFile('workstation'))
    if (!existsSync(path)) {
      writeFileSync(
        path,
        `# Defaults for profiles with target: workstation (VM on this machine).\n`,
        'utf8',
      )
    }
    const remaps = remapsByTarget.workstation
    if (remaps) {
      writeTargetWithRemaps(path, remaps, workstationToPlain(answers.workstation))
    } else {
      writeTargetYamlFile(path, workstationToPlain(answers.workstation))
    }
  } else if (remapsByTarget.workstation) {
    const path = join(provisionDir, provisionTargetFile('workstation'))
    if (!existsSync(path)) {
      writeFileSync(
        path,
        `# Defaults for profiles with target: workstation (VM on this machine).\n`,
        'utf8',
      )
    }
    writeTargetWithRemaps(path, remapsByTarget.workstation)
  }

  if (answers.proxmox) {
    const path = join(provisionDir, provisionTargetFile('proxmox'))
    if (!existsSync(path)) {
      writeFileSync(path, `# Defaults for profiles with target: proxmox.\n`, 'utf8')
    }
    const remaps = remapsByTarget.proxmox
    const block = proxmoxToPlain(answers.proxmox)
    if (remaps) {
      writeTargetWithRemaps(path, remaps, block, answers.proxmox.apiToken)
    } else {
      writeTargetYamlFile(path, block, answers.proxmox.apiToken)
    }

    /** @type {Set<string>} */
    const envs = new Set()
    for (const spec of Object.values(ctx.profiles)) {
      if (spec.target === 'proxmox') envs.add(spec.env)
    }
    applyApiTokenSecrets(root, answers.proxmox.apiToken, [...envs])
  } else if (remapsByTarget.proxmox) {
    const path = join(provisionDir, provisionTargetFile('proxmox'))
    if (!existsSync(path)) {
      writeFileSync(path, `# Defaults for profiles with target: proxmox.\n`, 'utf8')
    }
    writeTargetWithRemaps(path, remapsByTarget.proxmox)
  }
}
