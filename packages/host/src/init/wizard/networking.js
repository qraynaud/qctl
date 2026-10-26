/**
 * Custom init — networking (ports + labeled interfaces + optional ethernet.vm).
 * Shared across envs → common.yaml; otherwise each env-*.yaml.
 * Per-profile L3 (addresses) → profile-*.yaml overlays.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { provisionEnvFile, provisionProfileFile } from '@qctl/shared'

import { asBindingPrompts } from '../../lib/binding.js'
import { BRIDGE_RE, IFACE_RE } from '../../provision/schema/zod-utils.js'
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
 * @typedef {object} EthernetVmAnswers
 * @property {'bridge' | 'nat'} mode
 * @property {string} [bridge] required when mode is bridge
 * @property {number | number[] | string} [vlan] access id or trunk list/range
 * @property {string} [mac]
 */

/**
 * @typedef {object} EthernetAnswers
 * @property {'ethernet'} type
 * @property {string} [iface]
 * @property {{ dhcp?: boolean }} [ipv4]
 * @property {EthernetVmAnswers} [vm]
 */

/**
 * @typedef {object} VlanAnswers
 * @property {'vlan'} type
 * @property {number} id
 * @property {string} parent ethernet label
 * @property {string} [iface]
 */

/**
 * @typedef {object} DummyAnswers
 * @property {'dummy'} type
 * @property {string} [iface]
 */

/** @typedef {EthernetAnswers | VlanAnswers | DummyAnswers} InterfaceAnswers */

/**
 * Writer-shaped networking fragment (schema input).
 * @typedef {NonNullable<ProvisionFileInput['networking']>} NetworkingPlain
 */

/**
 * @typedef {object} NetworkingTopology
 * @property {Record<string, PortAnswers>} ports
 * @property {Record<string, InterfaceAnswers>} interfaces
 */

/**
 * @typedef {object} NetworkingWizardAnswers
 * @property {boolean} shared Write base networking to common.yaml
 * @property {NetworkingTopology} topology ports + interfaces (structure; L3 overlays separate)
 * @property {Record<string, Record<string, string>>} l3ByProfile
 *   profile → label → ipv4 CIDR (or bare IP → /24)
 */

/** Lab-style named ports (matches provision env-dev scaffold). */
export const LAB_PORT_PRESETS = Object.freeze({
  ssh: Object.freeze({ port: 22, forward: 2222 }),
  cockpit: Object.freeze({ port: 9090, forward: 9090 }),
  http: Object.freeze({ port: 80, forward: 8088, dnat: 8088 }),
  https: Object.freeze({ port: 443, forward: 8443, dnat: 8443 }),
})

const IPV4_CIDR_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:3[0-2]|[12]?\d))?$/

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
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
function validateOptionalIpv4Cidr(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  if (!IPV4_CIDR_RE.test(t)) return 'Must be IPv4 or IPv4/CIDR (or empty to omit)'
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
 * Bare IPv4 → /24; already CIDR → as-is.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeIpv4Cidr(raw) {
  const t = String(raw).trim()
  return t.includes('/') ? t : `${t}/24`
}

/**
 * Ethernet labels in topology (hypervisor / parent candidates).
 * @param {NetworkingTopology | null | undefined} topology
 * @returns {string[]}
 */
export function ethernetLabels(topology) {
  if (!topology) return []
  return Object.entries(topology.interfaces)
    .filter(([, e]) => e.type === 'ethernet')
    .map(([label]) => label)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * @returns {NetworkingTopology}
 */
export function defaultNetworkingTopology() {
  return {
    ports: structuredClone(/** @type {Record<string, PortAnswers>} */ ({ ...LAB_PORT_PRESETS })),
    interfaces: {
      main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
    },
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
    l3ByProfile: {},
  }
}

/**
 * Schema-shaped plain object for YAML (no profile L3 addresses).
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

  /** @type {NonNullable<NetworkingPlain['interfaces']>} */
  const interfaces = {}
  for (const [label, e] of Object.entries(topology.interfaces)) {
    if (e.type === 'ethernet') {
      /** @type {NonNullable<NetworkingPlain['interfaces']>[string] & { type: 'ethernet' }} */
      const row = { type: 'ethernet' }
      if (e.iface) row.iface = e.iface
      if (e.ipv4?.dhcp) row.ipv4 = { dhcp: true }
      if (e.vm?.mode === 'nat') {
        row.vm = { mode: 'nat', ...(e.vm.mac ? { mac: e.vm.mac } : {}) }
      } else if (e.vm?.mode === 'bridge' && e.vm.bridge) {
        row.vm = {
          mode: 'bridge',
          bridge: e.vm.bridge,
          ...(e.vm.vlan != null ? { vlan: e.vm.vlan } : {}),
          ...(e.vm.mac ? { mac: e.vm.mac } : {}),
        }
      }
      interfaces[label] = row
    } else if (e.type === 'vlan') {
      interfaces[label] = {
        type: 'vlan',
        id: e.id,
        parent: e.parent,
        ...(e.iface ? { iface: e.iface } : {}),
      }
    } else {
      interfaces[label] = {
        type: 'dummy',
        ...(e.iface ? { iface: e.iface } : {}),
      }
    }
  }
  return { ports, interfaces }
}

/**
 * Profile overlay: label → ipv4 addresses only.
 * @param {Record<string, string>} cidrByLabel
 * @returns {NetworkingPlain}
 */
export function l3OverlayToPlain(cidrByLabel) {
  /** @type {NonNullable<NetworkingPlain['interfaces']>} */
  const interfaces = {}
  for (const [label, cidr] of Object.entries(cidrByLabel)) {
    if (!cidr) continue
    interfaces[label] = { ipv4: { addresses: [normalizeIpv4Cidr(cidr)] } }
  }
  return { interfaces }
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
      if (keys.length <= 1) continue
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
 * @param {string} label
 * @param {EthernetAnswers} [initial]
 * @returns {Promise<EthernetAnswers | symbol>}
 */
async function promptEthernetEntry(p, label, initial) {
  const needIface = !IFACE_RE.test(label)
  /** @type {string | undefined} */
  let iface = initial?.iface
  if (needIface || initial?.iface) {
    const ifaceRaw = await p.text({
      message: `Guest iface for label ${label}${needIface ? '' : ' (empty = use label)'}`,
      initialValue: initial?.iface || (needIface ? '' : label),
      placeholder: needIface ? 'eth0' : label,
      validate: (v) => {
        const t = String(v ?? '').trim()
        if (!t && needIface) return 'iface required when label is not a Linux name'
        if (t) return validateIfaceName(t)
        return undefined
      },
    })
    if (p.isCancel(ifaceRaw)) return /** @type {symbol} */ (ifaceRaw)
    const t = String(ifaceRaw).trim()
    iface = t || undefined
  }

  const dhcp = await p.confirm({
    message: `IPv4 DHCP on ${label}? (default is static/off — opt in)`,
    initialValue: initial?.ipv4?.dhcp === true,
  })
  if (p.isCancel(dhcp)) return /** @type {symbol} */ (dhcp)

  return {
    type: 'ethernet',
    ...(iface ? { iface } : {}),
    ...(dhcp ? { ipv4: { dhcp: true } } : {}),
  }
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<Record<string, InterfaceAnswers> | symbol>}
 */
async function promptEthernetInterfaces(p) {
  /** @type {Record<string, InterfaceAnswers>} */
  const interfaces = {
    main: { type: 'ethernet', iface: 'eth0', ipv4: { dhcp: true } },
  }

  for (;;) {
    const etherKeys = Object.keys(interfaces).filter((l) => interfaces[l]?.type === 'ethernet')
    const picked = await p.select({
      message: 'Ethernet interfaces',
      options: [
        { value: 'done', label: 'Done' },
        { value: 'add', label: 'Add ethernet' },
        { value: 'edit', label: 'Edit ethernet' },
        { value: 'remove', label: 'Remove ethernet' },
      ],
      initialValue: 'done',
    })
    if (p.isCancel(picked)) return /** @type {symbol} */ (picked)
    const action = /** @type {'done' | 'add' | 'edit' | 'remove'} */ (picked)

    if (action === 'done') {
      if (etherKeys.length < 1) continue
      break
    }

    if (action === 'add') {
      const labelRaw = await p.text({
        message: 'Label (e.g. main, lab)',
        placeholder: 'lab',
        validate: (v) => {
          const t = String(v ?? '').trim()
          if (!t) return 'Label required'
          if (interfaces[t]) return `Label ${t} already defined`
          return undefined
        },
      })
      if (p.isCancel(labelRaw)) return /** @type {symbol} */ (labelRaw)
      const label = String(labelRaw).trim()
      const entry = await promptEthernetEntry(p, label)
      if (typeof entry === 'symbol') return entry
      interfaces[label] = entry
      continue
    }

    const which = await p.select({
      message: action === 'edit' ? 'Edit which ethernet?' : 'Remove which ethernet?',
      options: etherKeys.map((k) => {
        const e = interfaces[k]
        const iface = e && e.type === 'ethernet' ? e.iface || k : k
        const dhcp = e && e.type === 'ethernet' && e.ipv4?.dhcp ? 'dhcp' : 'no-dhcp'
        return { value: k, label: `${k} → ${iface} (${dhcp})` }
      }),
    })
    if (p.isCancel(which)) return /** @type {symbol} */ (which)
    const key = String(which)

    if (action === 'remove') {
      if (etherKeys.length <= 1) continue
      delete interfaces[key]
      continue
    }

    const cur = interfaces[key]
    const entry = await promptEthernetEntry(
      p,
      key,
      cur && cur.type === 'ethernet' ? cur : undefined,
    )
    if (typeof entry === 'symbol') return entry
    interfaces[key] = entry
  }

  return interfaces
}

/**
 * @param {BindingPrompts} p
 * @param {Record<string, InterfaceAnswers>} interfaces
 * @returns {Promise<symbol | void>}
 */
async function promptVlanOrDummy(p, interfaces) {
  const addAny = await p.confirm({
    message: 'Add VLAN or dummy interfaces?',
    initialValue: false,
  })
  if (p.isCancel(addAny)) return /** @type {symbol} */ (addAny)
  if (!addAny) return

  const etherKeys = ethernetLabels({ ports: {}, interfaces })

  let more = true
  while (more) {
    const kind = await p.select({
      message: 'Interface type',
      options: [
        { value: 'dummy', label: 'dummy (guest L3 only)' },
        { value: 'vlan', label: 'vlan (parent ethernet)' },
      ],
      initialValue: 'dummy',
    })
    if (p.isCancel(kind)) return /** @type {symbol} */ (kind)

    const labelRaw = await p.text({
      message: 'Label (e.g. vlan2)',
      placeholder: 'vlan2',
      validate: (v) => {
        const err = validateIfaceName(v)
        if (err) return err
        const t = String(v).trim()
        if (interfaces[t]) return `Label ${t} already defined`
        return undefined
      },
    })
    if (p.isCancel(labelRaw)) return /** @type {symbol} */ (labelRaw)
    const label = String(labelRaw).trim()

    if (kind === 'dummy') {
      interfaces[label] = { type: 'dummy' }
    } else {
      const idRaw = await p.text({
        message: `VLAN id for ${label}`,
        placeholder: '2',
        validate: validateVlanId,
      })
      if (p.isCancel(idRaw)) return /** @type {symbol} */ (idRaw)

      /** @type {string} */
      let parent
      if (etherKeys.length === 1) {
        parent = /** @type {string} */ (etherKeys[0])
      } else {
        const picked = await p.select({
          message: `Parent ethernet label for ${label}`,
          options: etherKeys.map((u) => ({ value: u, label: u })),
        })
        if (p.isCancel(picked)) return /** @type {symbol} */ (picked)
        parent = String(picked)
      }

      interfaces[label] = {
        type: 'vlan',
        id: Number(String(idRaw).trim()),
        parent,
      }
    }

    const again = await p.confirm({
      message: 'Add another VLAN/dummy?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
}

/**
 * Optional host attach on ethernet labels.
 * @param {BindingPrompts} p
 * @param {Record<string, InterfaceAnswers>} interfaces
 * @returns {Promise<symbol | void>}
 */
async function promptOptionalVm(p, interfaces) {
  const etherKeys = ethernetLabels({ ports: {}, interfaces })
  const any = await p.confirm({
    message: 'Configure host attach (ethernet.vm) now?',
    initialValue: false,
  })
  if (p.isCancel(any)) return /** @type {symbol} */ (any)
  if (!any) return

  for (const label of etherKeys) {
    const e = interfaces[label]
    if (e?.type !== 'ethernet') continue

    const mode = await p.select({
      message: `Host attach for ${label}`,
      options: [
        { value: 'omit', label: 'Omit (no hypervisor NIC)' },
        { value: 'nat', label: 'nat (userspace / passt)' },
        { value: 'bridge', label: 'bridge' },
      ],
      initialValue: 'omit',
    })
    if (p.isCancel(mode)) return /** @type {symbol} */ (mode)
    if (mode === 'omit') {
      delete e.vm
      continue
    }
    if (mode === 'nat') {
      e.vm = { mode: 'nat' }
      continue
    }

    const bridgeRaw = await p.text({
      message: `Bridge for ${label}`,
      initialValue: 'vmbr0',
      validate: validateBridge,
    })
    if (p.isCancel(bridgeRaw)) return /** @type {symbol} */ (bridgeRaw)
    e.vm = { mode: 'bridge', bridge: String(bridgeRaw).trim() }
  }
}

/**
 * @param {BindingPrompts} p
 * @param {Record<string, InterfaceAnswers>} interfaces
 * @param {WizardScope | null} scope
 * @returns {Promise<Record<string, string> | symbol>}
 */
async function promptL3Addresses(p, interfaces, scope) {
  /** @type {Record<string, string>} */
  const out = {}
  const labels = Object.keys(interfaces).filter((l) => {
    const e = interfaces[l]
    return e && (e.type === 'vlan' || e.type === 'dummy')
  })
  for (const label of labels) {
    const raw = await p.text({
      message: wizardScoped(scope, `IPv4 CIDR on ${label} (empty = omit)`),
      placeholder: '10.42.2.2/24',
      validate: validateOptionalIpv4Cidr,
    })
    if (p.isCancel(raw)) return /** @type {symbol} */ (raw)
    const t = String(raw).trim()
    if (t) out[label] = normalizeIpv4Cidr(t)
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

  const interfaces = await promptEthernetInterfaces(p)
  if (typeof interfaces === 'symbol') return interfaces

  const extra = await promptVlanOrDummy(p, interfaces)
  if (typeof extra === 'symbol') return extra

  const vm = await promptOptionalVm(p, interfaces)
  if (typeof vm === 'symbol') return vm

  /** @type {Record<string, Record<string, string>>} */
  const l3ByProfile = {}
  const l3Labels = Object.keys(interfaces).filter((l) => {
    const e = interfaces[l]
    return e && (e.type === 'vlan' || e.type === 'dummy')
  })

  if (l3Labels.length > 0) {
    const setL3 = await p.confirm({
      message: 'Set IPv4 addresses on VLAN/dummy interfaces?',
      initialValue: true,
    })
    if (p.isCancel(setL3)) return /** @type {symbol} */ (setL3)

    if (setL3) {
      /** @type {Map<string, string[]>} */
      const profilesByTarget = new Map()
      for (const [profile, spec] of Object.entries(profiles)) {
        const list = profilesByTarget.get(spec.target) ?? []
        list.push(profile)
        profilesByTarget.set(spec.target, list)
      }

      if (profilesByTarget.size > 1) {
        for (const [target, profileKeys] of profilesByTarget) {
          const addrs = await promptL3Addresses(p, interfaces, { target })
          if (typeof addrs === 'symbol') return addrs
          for (const profile of profileKeys) {
            if (Object.keys(addrs).length) l3ByProfile[profile] = { ...addrs }
          }
        }
      } else {
        const onlyTarget = [...profilesByTarget.keys()][0]
        const addrs = await promptL3Addresses(
          p,
          interfaces,
          onlyTarget ? { target: onlyTarget } : null,
        )
        if (typeof addrs === 'symbol') return addrs
        if (Object.keys(addrs).length) {
          for (const profile of Object.keys(profiles)) {
            l3ByProfile[profile] = { ...addrs }
          }
        }
      }
    }
  }

  return {
    shared: Boolean(shareTopology),
    topology: { ports, interfaces },
    l3ByProfile,
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

  for (const [profile, cidrByLabel] of Object.entries(answers.l3ByProfile)) {
    if (!cidrByLabel || Object.keys(cidrByLabel).length === 0) continue
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
    writeNetworkingIntoYamlFile(path, l3OverlayToPlain(cidrByLabel))
  }
}
