/**
 * Custom init — networking (ports, uplinks, vlans + per-target ipv4 overlays).
 * Shared across envs → common.yaml; otherwise each env-*.yaml.
 * VLAN host ipv4 → profile-*.yaml overlays (per target when targets differ).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { provisionEnvFile, provisionProfileFile } from '@qctl/shared'

import { asBindingPrompts } from '../../lib/binding.js'
import { IFACE_RE } from '../../provision/schema/zod-utils.js'
import { wizardScoped, wizardStep } from './ui.js'

/** @import { BindingPrompts } from '../../lib/binding.js' */
/** @import { ProvisionFileInput } from '../../provision/schema/types.js' */
/** @import { EnvironmentWriteSpec, ProfileWriteSpec } from '../write-provision.js' */
/** @import { WizardScope } from './ui.js' */

/**
 * @typedef {object} PortAnswers
 * @property {number} port
 * @property {number} [forward]
 * @property {number} [dnat]
 */

/**
 * @typedef {object} UplinkAnswers
 * @property {boolean} dhcp4
 */

/**
 * VLAN structure (no host ipv4).
 * @typedef {object} VlanAnswers
 * @property {number} id
 * @property {string} [link]
 */

/**
 * Writer-shaped networking fragment (full base or ipv4-only overlay).
 * @typedef {{
 *   ports?: Record<string, PortAnswers>
 *   uplinks?: Record<string, UplinkAnswers>
 *   vlans?: Record<string, { id?: number, link?: string, ipv4?: string }>
 * }} NetworkingPlain
 */

/**
 * @typedef {object} NetworkingTopology
 * @property {Record<string, PortAnswers>} ports
 * @property {Record<string, UplinkAnswers>} uplinks
 * @property {Record<string, VlanAnswers>} vlans
 */

/**
 * @typedef {object} NetworkingWizardAnswers
 * @property {boolean} shared Write base networking to common.yaml
 * @property {NetworkingTopology} topology ports / uplinks / vlans (no ipv4)
 * @property {Record<string, Record<string, string>>} ipv4ByProfile
 *   profile → vlanName → ipv4
 */

/** Lab-style named ports (matches provision env-dev scaffold). */
export const LAB_PORT_PRESETS = Object.freeze({
  ssh: Object.freeze({ port: 22, forward: 2222 }),
  cockpit: Object.freeze({ port: 9090, forward: 9090 }),
  http: Object.freeze({ port: 80, forward: 8088, dnat: 8088 }),
  https: Object.freeze({ port: 443, forward: 8443, dnat: 8443 }),
})

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/

/**
 * @param {string | undefined} raw
 * @returns {string | undefined} Error, or undefined if ok
 */
function validatePortNum(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'Port required (1–65535)'
  const n = Number(t)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Port must be 1–65535'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalPortNum(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  return validatePortNum(t)
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateIfaceName(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'Interface name required'
  if (!IFACE_RE.test(t)) return 'Must be a Linux interface name (e.g. eth0, vlan2)'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalIpv4(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  if (!IPV4_RE.test(t)) return 'Must be an IPv4 address (or empty to omit)'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateVlanId(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'VLAN id required (1–4094)'
  const n = Number(t)
  if (!Number.isInteger(n) || n < 1 || n > 4094) return 'VLAN id must be 1–4094'
  return undefined
}

/**
 * @returns {NetworkingTopology}
 */
export function defaultNetworkingTopology() {
  return {
    ports: structuredClone(/** @type {Record<string, PortAnswers>} */ ({ ...LAB_PORT_PRESETS })),
    uplinks: { eth0: { dhcp4: true } },
    vlans: {},
  }
}

/**
 * @param {boolean} [shared]
 * @returns {NetworkingWizardAnswers}
 */
export function defaultNetworkingAnswers(shared = false) {
  return {
    shared,
    topology: defaultNetworkingTopology(),
    ipv4ByProfile: {},
  }
}

/**
 * Schema-shaped plain object for YAML (no ipv4 on vlans).
 * @param {NetworkingTopology} topology
 * @returns {NetworkingPlain}
 */
export function topologyToPlain(topology) {
  /** @type {Record<string, PortAnswers>} */
  const ports = {}
  for (const [name, entry] of Object.entries(topology.ports)) {
    ports[name] = {
      port: entry.port,
      ...(entry.forward != null ? { forward: entry.forward } : {}),
      ...(entry.dnat != null ? { dnat: entry.dnat } : {}),
    }
  }
  /** @type {Record<string, { dhcp4: boolean }>} */
  const uplinks = {}
  for (const [name, u] of Object.entries(topology.uplinks)) {
    uplinks[name] = { dhcp4: u.dhcp4 }
  }
  /** @type {Record<string, { id: number, link?: string }>} */
  const vlans = {}
  for (const [name, v] of Object.entries(topology.vlans)) {
    vlans[name] = {
      id: v.id,
      ...(v.link ? { link: v.link } : {}),
    }
  }
  return { ports, uplinks, vlans }
}

/**
 * @param {Record<string, string>} ipv4ByVlan
 * @returns {NetworkingPlain}
 */
export function ipv4OverlayToPlain(ipv4ByVlan) {
  /** @type {NonNullable<NetworkingPlain['vlans']>} */
  const vlans = {}
  for (const [name, ipv4] of Object.entries(ipv4ByVlan)) {
    if (!ipv4) continue
    vlans[name] = { ipv4 }
  }
  return { vlans }
}

/**
 * @param {BindingPrompts} p
 * @param {string} message
 * @param {number} [initial]
 * @returns {Promise<number | undefined | symbol>}
 */
async function promptOptionalPort(p, message, initial) {
  const raw = await p.text({
    message,
    initialValue: initial != null ? String(initial) : '',
    placeholder: 'omit',
    validate: validateOptionalPortNum,
  })
  if (p.isCancel(raw)) return /** @type {symbol} */ (raw)
  const t = String(raw).trim()
  if (!t) return undefined
  return Number(t)
}

/**
 * @param {BindingPrompts} p
 * @param {string} [name]
 * @param {PortAnswers} [initial]
 * @returns {Promise<PortAnswers | symbol>}
 */
async function promptPortEntry(p, name, initial) {
  const portRaw = await p.text({
    message: name ? `Guest port for ${name}` : 'Guest port',
    initialValue: initial ? String(initial.port) : '',
    validate: validatePortNum,
  })
  if (p.isCancel(portRaw)) return /** @type {symbol} */ (portRaw)

  const forward = await promptOptionalPort(p, 'Host forward port (empty = none)', initial?.forward)
  if (typeof forward === 'symbol') return forward

  const dnat = await promptOptionalPort(p, 'DNAT port (empty = none)', initial?.dnat)
  if (typeof dnat === 'symbol') return dnat

  return {
    port: Number(String(portRaw).trim()),
    ...(forward != null ? { forward } : {}),
    ...(dnat != null ? { dnat } : {}),
  }
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<Record<string, PortAnswers> | symbol>}
 */
async function promptPorts(p) {
  /** @type {Record<string, PortAnswers>} */
  let ports = structuredClone(/** @type {Record<string, PortAnswers>} */ ({ ...LAB_PORT_PRESETS }))

  const useLab = await p.confirm({
    message: 'Use lab port presets (ssh, cockpit, http, https)?',
    initialValue: true,
  })
  if (p.isCancel(useLab)) return /** @type {symbol} */ (useLab)
  if (!useLab) ports = {}

  for (;;) {
    /** @type {'done' | 'add' | 'edit' | 'remove'} */
    let action
    if (Object.keys(ports).length === 0) {
      action = 'add'
    } else {
      const picked = await p.select({
        message: 'Ports',
        options: [
          { value: 'done', label: 'Done' },
          { value: 'add', label: 'Add port' },
          { value: 'edit', label: 'Edit port' },
          { value: 'remove', label: 'Remove port' },
        ],
        initialValue: 'done',
      })
      if (p.isCancel(picked)) return /** @type {symbol} */ (picked)
      action = /** @type {'done' | 'add' | 'edit' | 'remove'} */ (picked)
    }

    if (action === 'done') break

    if (action === 'add') {
      const name = await p.text({
        message: 'Port name',
        placeholder: 'http',
        validate: (v) => {
          const t = String(v ?? '').trim()
          if (!t) return 'Name required'
          if (ports[t]) return `Port ${t} already defined`
          return undefined
        },
      })
      if (p.isCancel(name)) return /** @type {symbol} */ (name)
      const entry = await promptPortEntry(p, String(name).trim())
      if (typeof entry === 'symbol') return entry
      ports[String(name).trim()] = entry
      continue
    }

    const keys = Object.keys(ports)
    const which = await p.select({
      message: action === 'edit' ? 'Edit which port?' : 'Remove which port?',
      options: keys.map((k) => ({
        value: k,
        label: `${k} → ${ports[k]?.port}${ports[k]?.forward != null ? ` (fwd ${ports[k].forward})` : ''}`,
      })),
    })
    if (p.isCancel(which)) return /** @type {symbol} */ (which)
    const key = String(which)

    if (action === 'remove') {
      if (keys.length <= 1) {
        // Keep ≥1; re-prompt.
        continue
      }
      delete ports[key]
      continue
    }

    const entry = await promptPortEntry(p, key, ports[key])
    if (typeof entry === 'symbol') return entry
    ports[key] = entry
  }

  return ports
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<Record<string, UplinkAnswers> | symbol>}
 */
async function promptUplinks(p) {
  /** @type {Record<string, UplinkAnswers>} */
  const uplinks = { eth0: { dhcp4: true } }

  for (;;) {
    const picked = await p.select({
      message: 'Uplinks',
      options: [
        { value: 'done', label: 'Done' },
        { value: 'add', label: 'Add uplink' },
        { value: 'edit', label: 'Edit dhcp4' },
        { value: 'remove', label: 'Remove uplink' },
      ],
      initialValue: 'done',
    })
    if (p.isCancel(picked)) return /** @type {symbol} */ (picked)
    const action = /** @type {'done' | 'add' | 'edit' | 'remove'} */ (picked)

    if (action === 'done') {
      if (Object.keys(uplinks).length < 1) continue
      break
    }

    if (action === 'add') {
      const name = await p.text({
        message: 'Uplink interface name',
        placeholder: 'eth1',
        validate: (v) => {
          const err = validateIfaceName(v)
          if (err) return err
          const t = String(v).trim()
          if (uplinks[t]) return `Uplink ${t} already defined`
          return undefined
        },
      })
      if (p.isCancel(name)) return /** @type {symbol} */ (name)
      const dhcp4 = await p.confirm({
        message: `DHCP on ${String(name).trim()}?`,
        initialValue: true,
      })
      if (p.isCancel(dhcp4)) return /** @type {symbol} */ (dhcp4)
      uplinks[String(name).trim()] = { dhcp4: Boolean(dhcp4) }
      continue
    }

    const keys = Object.keys(uplinks)
    const which = await p.select({
      message: action === 'edit' ? 'Edit which uplink?' : 'Remove which uplink?',
      options: keys.map((k) => ({
        value: k,
        label: `${k} (dhcp4=${uplinks[k]?.dhcp4 !== false})`,
      })),
    })
    if (p.isCancel(which)) return /** @type {symbol} */ (which)
    const key = String(which)

    if (action === 'remove') {
      if (keys.length <= 1) continue
      delete uplinks[key]
      continue
    }

    const dhcp4 = await p.confirm({
      message: `DHCP on ${key}?`,
      initialValue: uplinks[key]?.dhcp4 !== false,
    })
    if (p.isCancel(dhcp4)) return /** @type {symbol} */ (dhcp4)
    uplinks[key] = { dhcp4: Boolean(dhcp4) }
  }

  return uplinks
}

/**
 * @param {BindingPrompts} p
 * @param {Record<string, UplinkAnswers>} uplinks
 * @returns {Promise<Record<string, VlanAnswers> | symbol>}
 */
async function promptVlans(p, uplinks) {
  /** @type {Record<string, VlanAnswers>} */
  const vlans = {}
  const uplinkKeys = Object.keys(uplinks)

  const addAny = await p.confirm({
    message: 'Add VLANs?',
    initialValue: false,
  })
  if (p.isCancel(addAny)) return /** @type {symbol} */ (addAny)
  if (!addAny) return vlans

  let more = true
  while (more) {
    const name = await p.text({
      message: 'VLAN interface name',
      placeholder: 'vlan2',
      validate: (v) => {
        const err = validateIfaceName(v)
        if (err) return err
        const t = String(v).trim()
        if (vlans[t]) return `VLAN ${t} already defined`
        if (uplinks[t]) return `${t} collides with an uplink`
        return undefined
      },
    })
    if (p.isCancel(name)) return /** @type {symbol} */ (name)
    const key = String(name).trim()

    const idRaw = await p.text({
      message: `VLAN id for ${key}`,
      placeholder: '2',
      validate: validateVlanId,
    })
    if (p.isCancel(idRaw)) return /** @type {symbol} */ (idRaw)

    /** @type {string | undefined} */
    let link
    if (uplinkKeys.length === 1) {
      link = uplinkKeys[0]
    } else {
      const picked = await p.select({
        message: `Parent uplink for ${key}`,
        options: uplinkKeys.map((u) => ({ value: u, label: u })),
      })
      if (p.isCancel(picked)) return /** @type {symbol} */ (picked)
      link = String(picked)
    }

    vlans[key] = {
      id: Number(String(idRaw).trim()),
      ...(link ? { link } : {}),
    }

    const again = await p.confirm({
      message: 'Add another VLAN?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }

  return vlans
}

/**
 * @param {BindingPrompts} p
 * @param {Record<string, VlanAnswers>} vlans
 * @param {WizardScope | null} scope
 * @returns {Promise<Record<string, string> | symbol>}
 */
async function promptVlanIpv4s(p, vlans, scope) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const name of Object.keys(vlans)) {
    const raw = await p.text({
      message: wizardScoped(scope, `Host ipv4 on ${name} (empty = omit)`),
      placeholder: '10.42.2.2',
      validate: validateOptionalIpv4,
    })
    if (p.isCancel(raw)) return /** @type {symbol} */ (raw)
    const t = String(raw).trim()
    if (t) out[name] = t
  }
  return out
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   profiles: Record<string, ProfileWriteSpec>
 *   shareTopology: boolean
 * }} opts
 * @returns {Promise<NetworkingWizardAnswers | symbol>}
 */
export async function promptNetworking(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const { profiles, shareTopology } = opts

  wizardStep(p, 'Networking')

  const ports = await promptPorts(p)
  if (typeof ports === 'symbol') return ports

  const uplinks = await promptUplinks(p)
  if (typeof uplinks === 'symbol') return uplinks

  const vlans = await promptVlans(p, uplinks)
  if (typeof vlans === 'symbol') return vlans

  /** @type {Record<string, Record<string, string>>} */
  const ipv4ByProfile = {}

  if (Object.keys(vlans).length > 0) {
    const setIpv4 = await p.confirm({
      message: 'Set host ipv4 on VLANs?',
      initialValue: true,
    })
    if (p.isCancel(setIpv4)) return /** @type {symbol} */ (setIpv4)

    if (setIpv4) {
      /** @type {Map<string, string[]>} */
      const profilesByTarget = new Map()
      for (const [profile, spec] of Object.entries(profiles)) {
        const list = profilesByTarget.get(spec.target) ?? []
        list.push(profile)
        profilesByTarget.set(spec.target, list)
      }

      if (profilesByTarget.size > 1) {
        for (const [target, profileKeys] of profilesByTarget) {
          const ipv4s = await promptVlanIpv4s(p, vlans, { target })
          if (typeof ipv4s === 'symbol') return ipv4s
          for (const profile of profileKeys) {
            if (Object.keys(ipv4s).length) ipv4ByProfile[profile] = { ...ipv4s }
          }
        }
      } else {
        const onlyTarget = [...profilesByTarget.keys()][0]
        const ipv4s = await promptVlanIpv4s(p, vlans, onlyTarget ? { target: onlyTarget } : null)
        if (typeof ipv4s === 'symbol') return ipv4s
        if (Object.keys(ipv4s).length) {
          for (const profile of Object.keys(profiles)) {
            ipv4ByProfile[profile] = { ...ipv4s }
          }
        }
      }
    }
  }

  return {
    shared: Boolean(shareTopology),
    topology: { ports, uplinks, vlans },
    ipv4ByProfile,
  }
}

/**
 * Mutable provision YAML while patching `networking:`.
 * @typedef {Partial<Omit<ProvisionFileInput, 'networking'>> & {
 *   networking?: NetworkingPlain
 * }} ProvisionYamlDoc
 */

/**
 * @param {string} path
 * @param {NetworkingPlain} networkingPlain
 */
function writeNetworkingIntoYamlFile(path, networkingPlain) {
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
  doc.networking = networkingPlain
  const text = header + YAML.stringify(doc, { lineWidth: 100 })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/**
 * Apply networking answers into provision YAML layers.
 * @param {string} root
 * @param {NetworkingWizardAnswers} answers
 * @param {{
 *   profiles: Record<string, ProfileWriteSpec>
 *   environments: Record<string, EnvironmentWriteSpec>
 * }} ctx
 */
export function applyNetworkingAnswers(root, answers, ctx) {
  const base = topologyToPlain(answers.topology)
  const provisionDir = join(root, 'provision')

  if (answers.shared) {
    const commonPath = join(provisionDir, 'common.yaml')
    if (!existsSync(commonPath)) {
      writeFileSync(commonPath, `# Shared provision settings for every profile.\n`, 'utf8')
    }
    writeNetworkingIntoYamlFile(commonPath, base)
  } else {
    /** @type {Set<string>} */
    const envsWritten = new Set()
    for (const spec of Object.values(ctx.profiles)) {
      if (envsWritten.has(spec.env)) continue
      envsWritten.add(spec.env)
      const path = join(provisionDir, provisionEnvFile(spec.env))
      if (!existsSync(path)) {
        writeFileSync(
          path,
          `# Env "${spec.env}" — shared by every profile that uses env: ${spec.env}.\n`,
          'utf8',
        )
      }
      writeNetworkingIntoYamlFile(path, base)
    }
    // No profiles yet — still write for declared envs.
    if (envsWritten.size === 0) {
      for (const env of Object.keys(ctx.environments)) {
        const path = join(provisionDir, provisionEnvFile(env))
        if (!existsSync(path)) {
          writeFileSync(path, `# Env "${env}".\n`, 'utf8')
        }
        writeNetworkingIntoYamlFile(path, base)
      }
    }
  }

  for (const [profile, ipv4ByVlan] of Object.entries(answers.ipv4ByProfile)) {
    if (!ipv4ByVlan || Object.keys(ipv4ByVlan).length === 0) continue
    const spec = ctx.profiles[profile]
    if (!spec) continue
    const path = join(provisionDir, provisionProfileFile(profile))
    if (!existsSync(path)) {
      writeFileSync(
        path,
        `# Profile "${profile}" (env=${spec.env}, target=${spec.target}) — overrides for this profile only.\n`,
        'utf8',
      )
    }
    writeNetworkingIntoYamlFile(path, ipv4OverlayToPlain(ipv4ByVlan))
  }
}
