/**
 * Custom init — hypervisor target overlays (workstation / proxmox).
 * One prompt pass per unique target → `provision/target-*.yaml`.
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
import { BRIDGE_RE } from '../../provision/schema/zod-utils.js'
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
const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/

/**
 * @typedef {object} WorkstationOverlayAnswers
 * @property {number} cpu
 * @property {number} memory
 */

/**
 * Proxmox NIC for one uplink key (writer shape before schema transform).
 * @typedef {object} ProxmoxNetAnswers
 * @property {string} bridge
 * @property {number} [tag] Access VLAN (xor trunks)
 * @property {Array<number | string>} [trunks] VLAN ids and/or "from-to" ranges
 * @property {string} [mac]
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
 * @property {Record<string, ProxmoxNetAnswers>} net keyed by uplink name
 */

/**
 * @typedef {object} OverlaysWizardAnswers
 * @property {WorkstationOverlayAnswers} [workstation]
 * @property {ProxmoxOverlayAnswers} [proxmox]
 */

/**
 * @returns {WorkstationOverlayAnswers}
 */
export function defaultWorkstationOverlay() {
  return { cpu: 2, memory: 4096 }
}

/**
 * @param {string[]} uplinkKeys
 * @returns {ProxmoxOverlayAnswers}
 */
export function defaultProxmoxOverlay(uplinkKeys = ['eth0']) {
  /** @type {Record<string, ProxmoxNetAnswers>} */
  const net = {}
  for (const name of uplinkKeys) {
    net[name] = { bridge: 'vmbr0' }
  }
  return {
    apiUrl: 'https://pve.example:8006',
    node: 'pve',
    cpu: 2,
    memory: 4096,
    apiToken: { kind: 'secret', name: 'PROXMOX_API_TOKEN', encoding: 'utf8' },
    net,
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
  /** @type {NonNullable<ProxmoxInput['net']>} */
  const net = {}
  for (const [name, entry] of Object.entries(pve.net)) {
    /** @type {NonNullable<ProxmoxInput['net']>[string]} */
    const row = { bridge: entry.bridge }
    if (entry.tag != null) row.tag = entry.tag
    if (entry.trunks?.length) row.trunks = entry.trunks
    if (entry.mac) row.mac = entry.mac.toUpperCase()
    net[name] = row
  }

  /** @type {ProxmoxInput} */
  const proxmox = {
    api_url: pve.apiUrl,
    node: pve.node,
    cpu: pve.cpu,
    memory: pve.memory,
    net,
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
function validateBridge(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'Bridge name required'
  if (!BRIDGE_RE.test(t)) return 'Must be a Linux bridge name (e.g. vmbr0)'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalMac(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  if (!MAC_RE.test(t)) return 'MAC must look like aa:bb:cc:dd:ee:ff'
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
 * Parse trunks prompt: `2,10-12,20` → `[2, "10-12", 20]` (schema expands ranges).
 * @param {string} raw
 * @returns {Array<number | string> | string} Parsed list, or error message
 */
export function parseTrunksInput(raw) {
  const parts = String(raw ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'At least one VLAN id or range required'
  /** @type {Array<number | string>} */
  const out = []
  for (const p of parts) {
    if (/^\d+-\d+$/.test(p)) {
      const [a, b] = p.split('-').map(Number)
      if (a < 1 || b > 4094 || a > b) return `Bad trunk range ${p}`
      out.push(p)
      continue
    }
    const n = Number(p)
    if (!Number.isInteger(n) || n < 1 || n > 4094) return `Bad VLAN id ${p}`
    out.push(n)
  }
  return out
}

/**
 * Expand trunks for carriage checks (mirrors schema loosely).
 * @param {Array<number | string>} trunks
 * @returns {number[]}
 */
export function expandTrunkIds(trunks) {
  /** @type {number[]} */
  const ids = []
  for (const t of trunks) {
    if (typeof t === 'number') {
      ids.push(t)
      continue
    }
    const m = /^(\d+)-(\d+)$/.exec(String(t))
    if (m) {
      const from = Number(m[1])
      const to = Number(m[2])
      for (let i = from; i <= to; i++) ids.push(i)
    } else {
      const n = Number(t)
      if (Number.isInteger(n)) ids.push(n)
    }
  }
  return [...new Set(ids)].sort((a, b) => a - b)
}

/**
 * VLAN ids that must be carried on a given uplink's proxmox.net entry.
 * @param {NetworkingTopology | null | undefined} topology
 * @param {string} uplink
 * @returns {number[]}
 */
export function vlanIdsForUplink(topology, uplink) {
  if (!topology) return []
  /** @type {number[]} */
  const ids = []
  const uplinkKeys = Object.keys(topology.uplinks)
  const sole = uplinkKeys.length === 1 ? uplinkKeys[0] : undefined
  for (const v of Object.values(topology.vlans)) {
    const link = v.link ?? sole
    if (link === uplink) ids.push(v.id)
  }
  return [...new Set(ids)].sort((a, b) => a - b)
}

/**
 * @param {ProxmoxNetAnswers} net
 * @param {number[]} requiredIds
 * @returns {string | undefined} Error message
 */
export function validateNetCarriesVlans(net, requiredIds) {
  if (requiredIds.length === 0) return undefined
  /** @type {Set<number>} */
  const carried = new Set()
  if (net.tag != null) carried.add(net.tag)
  if (net.trunks?.length) {
    for (const id of expandTrunkIds(net.trunks)) carried.add(id)
  }
  const missing = requiredIds.filter((id) => !carried.has(id))
  if (missing.length === 0) return undefined
  return `Must carry VLAN id(s) ${missing.join(', ')} via tag or trunks`
}

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
 * @typedef {{ target?: string }} WizardScopeLike
 */

/**
 * @param {BindingPrompts} p
 * @param {string} uplink
 * @param {number[]} requiredVlanIds
 * @param {WizardScopeLike} scope
 * @returns {Promise<ProxmoxNetAnswers | symbol>}
 */
async function promptProxmoxNet(p, uplink, requiredVlanIds, scope) {
  const bridgeRaw = await p.text({
    message: wizardScoped(scope, `Bridge for uplink ${uplink}`),
    initialValue: 'vmbr0',
    validate: validateBridge,
  })
  if (p.isCancel(bridgeRaw)) return /** @type {symbol} */ (bridgeRaw)

  /** @type {'none' | 'tag' | 'trunks'} */
  let modeInitial = 'none'
  if (requiredVlanIds.length === 1) modeInitial = 'tag'
  else if (requiredVlanIds.length > 1) modeInitial = 'trunks'

  const mode = await p.select({
    message: wizardScoped(scope, `VLAN mode on ${uplink}`),
    options: [
      { value: 'none', label: 'None (untagged)' },
      { value: 'tag', label: 'Access (tag / vlan)' },
      { value: 'trunks', label: 'Trunks (ids / ranges)' },
    ],
    initialValue: modeInitial,
  })
  if (p.isCancel(mode)) return /** @type {symbol} */ (mode)

  /** @type {ProxmoxNetAnswers} */
  const net = { bridge: String(bridgeRaw).trim() }

  if (mode === 'tag') {
    const suggest = requiredVlanIds[0] != null ? String(requiredVlanIds[0]) : ''
    const tagRaw = await p.text({
      message: wizardScoped(scope, `Access VLAN tag for ${uplink}`),
      initialValue: suggest,
      validate: (v) => {
        const n = Number(String(v ?? '').trim())
        if (!Number.isInteger(n) || n < 1 || n > 4094) return 'VLAN tag 1–4094'
        return undefined
      },
    })
    if (p.isCancel(tagRaw)) return /** @type {symbol} */ (tagRaw)
    net.tag = Number(String(tagRaw).trim())
  } else if (mode === 'trunks') {
    const suggest = requiredVlanIds.length ? requiredVlanIds.join(',') : ''
    const trunksRaw = await p.text({
      message: wizardScoped(scope, `Trunks for ${uplink} (e.g. 2,10-12)`),
      initialValue: suggest,
      validate: (v) => {
        const parsed = parseTrunksInput(String(v ?? ''))
        return typeof parsed === 'string' ? parsed : undefined
      },
    })
    if (p.isCancel(trunksRaw)) return /** @type {symbol} */ (trunksRaw)
    const parsed = parseTrunksInput(String(trunksRaw))
    if (typeof parsed === 'string') throw new Error(parsed)
    net.trunks = parsed
  }

  const carryErr = validateNetCarriesVlans(net, requiredVlanIds)
  if (carryErr) {
    // Re-prompt trunks/tag by failing into a corrective trunks ask when needed.
    const fix = await p.text({
      message: wizardScoped(scope, `${carryErr}. Trunks or single tag covering those ids`),
      initialValue: requiredVlanIds.join(','),
      validate: (v) => {
        const t = String(v ?? '').trim()
        if (/^\d+$/.test(t)) {
          const n = Number(t)
          if (n < 1 || n > 4094) return 'VLAN 1–4094'
          const trial = { ...net, tag: n, trunks: undefined }
          return validateNetCarriesVlans(trial, requiredVlanIds)
        }
        const parsed = parseTrunksInput(t)
        if (typeof parsed === 'string') return parsed
        const trial = { ...net, tag: undefined, trunks: parsed }
        return validateNetCarriesVlans(trial, requiredVlanIds)
      },
    })
    if (p.isCancel(fix)) return /** @type {symbol} */ (fix)
    const t = String(fix).trim()
    if (/^\d+$/.test(t)) {
      delete net.trunks
      net.tag = Number(t)
    } else {
      delete net.tag
      const parsed = parseTrunksInput(t)
      if (typeof parsed === 'string') throw new Error(parsed)
      net.trunks = parsed
    }
  }

  const macRaw = await p.text({
    message: wizardScoped(scope, `MAC for ${uplink} (empty = omit)`),
    placeholder: 'aa:bb:cc:dd:ee:ff',
    validate: validateOptionalMac,
  })
  if (p.isCancel(macRaw)) return /** @type {symbol} */ (macRaw)
  const mac = String(macRaw).trim()
  if (mac) net.mac = mac

  return net
}

/**
 * @param {BindingPrompts} p
 * @param {{
 *   uplinkKeys: string[]
 *   topology?: NetworkingTopology | null
 * }} ctx
 * @param {WizardScopeLike} scope
 * @returns {Promise<ProxmoxOverlayAnswers | symbol>}
 */
async function promptProxmox(p, ctx, scope) {
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

  /** @type {Record<string, ProxmoxNetAnswers>} */
  const net = {}
  for (const uplink of ctx.uplinkKeys) {
    const required = vlanIdsForUplink(ctx.topology, uplink)
    const entry = await promptProxmoxNet(p, uplink, required, scope)
    if (typeof entry === 'symbol') return entry
    net[uplink] = entry
  }

  /** @type {ProxmoxOverlayAnswers} */
  const out = {
    apiUrl: String(apiUrl).trim(),
    node: String(node).trim(),
    cpu: Number(String(cpuRaw).trim()),
    memory: Number(String(memRaw).trim()),
    apiToken,
    net,
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
  const uplinkKeys = topology ? Object.keys(topology.uplinks) : ['eth0']

  /** @type {Set<'workstation' | 'proxmox'>} */
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
    const pve = await promptProxmox(p, { uplinkKeys, topology }, { target: 'proxmox' })
    if (typeof pve === 'symbol') return pve
    answers.proxmox = pve
  }

  return answers
}

/** @typedef {Partial<ProvisionFileInput>} TargetYamlDoc */

/**
 * @param {string} path
 * @param {{ workstation?: WorkstationInput, proxmox?: ProxmoxInput }} block
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
 * Write target overlays into `provision/target-*.yaml` (+ api_token secrets).
 * @param {string} root
 * @param {OverlaysWizardAnswers} answers
 * @param {{
 *   profiles: Record<string, ProfileWriteSpec>
 * }} ctx
 */
export function applyOverlaysAnswers(root, answers, ctx) {
  const provisionDir = join(root, 'provision')

  if (answers.workstation) {
    const path = join(provisionDir, provisionTargetFile('workstation'))
    if (!existsSync(path)) {
      writeFileSync(
        path,
        `# Defaults for profiles with target: workstation (VM on this machine).\n`,
        'utf8',
      )
    }
    writeTargetYamlFile(path, workstationToPlain(answers.workstation))
  }

  if (answers.proxmox) {
    const path = join(provisionDir, provisionTargetFile('proxmox'))
    if (!existsSync(path)) {
      writeFileSync(path, `# Defaults for profiles with target: proxmox.\n`, 'utf8')
    }
    writeTargetYamlFile(path, proxmoxToPlain(answers.proxmox), answers.proxmox.apiToken)

    /** @type {Set<string>} */
    const envs = new Set()
    for (const spec of Object.values(ctx.profiles)) {
      if (spec.target === 'proxmox') envs.add(spec.env)
    }
    applyApiTokenSecrets(root, answers.proxmox.apiToken, [...envs])
  }
}
