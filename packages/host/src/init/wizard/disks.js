/**
 * Custom init — disk topology.
 * 1) Same topology for all profiles? (default Yes when multi-profile)
 * 2) Structure once (or per profile): data mounts, tanks/vdevs member *names*
 * 3) Per profile: virtual|physical + size/id for OS, each data vol, each tank member
 * Shared → structure (+ passphrase) in common.yaml; profile-*.yaml only size/id.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { DISK_VDEV_MIN_MEMBERS, DISK_VDEV_ROLES, DISK_VDEV_TYPES } from '@qctl/shared'

import {
  asBindingPrompts,
  ensureEnvValue,
  ensureSchemaSecret,
  formatYamlValue,
  promptCredentialBinding,
} from '../../lib/binding.js'
import { wizardScoped, wizardStep } from './ui.js'
import { VAULTWARDEN_PLUGIN } from './varlock-plugins.js'

/** @import { TankOptionsInput } from '@qctl/shared' */
/** @import { BindingPrompts, CredentialBinding } from '../../lib/binding.js' */
/**
 * @import {
 *   DisksAttachmentOverlay,
 *   DisksDataVolumeInput,
 *   DisksInput,
 *   DisksMemberInput,
 *   DisksOsInput,
 *   DisksVdevInput,
 *   ProvisionFileInput,
 * } from '../../provision/schema/types.js'
 */
/** @import { ProfileWriteSpec } from '../write-provision.js' */
/** @import { WizardScope } from './ui.js' */
/** @import { VarlockPluginDep } from './varlock-plugins.js' */

/**
 * Wizard attachment: schema member/os fields + prompt `kind`.
 * @typedef {DisksMemberInput & { kind: 'virtual' | 'physical' }} DiskAttachment
 */

/** @typedef {Pick<DisksDataVolumeInput, 'mount' | 'fs'>} DataVolumeTopology */

/**
 * Vdev structure before member size/id (schema has `members` map).
 * @typedef {object} VdevTopology
 * @property {DisksVdevInput['role']} role
 * @property {DisksVdevInput['type']} type
 * @property {string[]} memberKeys
 */

/**
 * @typedef {object} TankTopology
 * @property {string} mount
 * @property {CredentialBinding} passphrase omit → unencrypted
 * @property {TankOptionsInput | null} options
 * @property {Record<string, VdevTopology>} vdevs
 */

/**
 * Structure only (no sizes / physical ids) — wizard intermediate.
 * @typedef {object} DisksTopology
 * @property {Record<string, DataVolumeTopology>} data
 * @property {Record<string, TankTopology>} tanks
 */

/**
 * Data volume answers: schema volume fields minus size/id, plus attachment.
 * @typedef {DataVolumeTopology & { disk: DiskAttachment }} DataVolumeAnswers
 */

/**
 * @typedef {object} VdevAnswers
 * @property {DisksVdevInput['role']} role
 * @property {DisksVdevInput['type']} type
 * @property {Record<string, DiskAttachment>} members
 */

/**
 * @typedef {object} TankAnswers
 * @property {string} mount
 * @property {CredentialBinding} passphrase
 * @property {TankOptionsInput | null} options
 * @property {Record<string, VdevAnswers>} vdevs
 */

/**
 * Complete disks for one profile (structure + attachments).
 * @typedef {object} EnvDisksAnswers
 * @property {DiskAttachment} os
 * @property {Record<string, DataVolumeAnswers>} data
 * @property {Record<string, TankAnswers>} tanks
 */

/**
 * @typedef {object} DisksWizardAnswers
 * @property {boolean} sharedStructure Same mounts/vdevs for every profile
 * @property {DisksTopology} [topology] Shared structure → written to common.yaml
 * @property {Record<string, EnvDisksAnswers>} byProfile Full disks / attachments per profile
 */

/**
 * @param {string} key
 * @returns {string}
 */
export function physicalIdPlaceholder(key) {
  const safe = String(key ?? '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return `SET_PHYSICAL_DISK_ID_${safe || 'DISK'}`
}

/**
 * @param {EnvDisksAnswers} disks
 * @returns {string | undefined} Error if invalid
 */
export function validateEnvDisks(disks) {
  const nData = Object.keys(disks.data).length
  const nTanks = Object.keys(disks.tanks).length
  if (nData === 0 && nTanks === 0) {
    return 'disks must include at least one data volume or tank'
  }
  for (const [tankKey, tank] of Object.entries(disks.tanks)) {
    const hasData = Object.values(tank.vdevs).some((v) => v.role === 'data')
    if (!hasData) return `tank ${tankKey} needs a vdev with role: data`
    for (const [vdevKey, vdev] of Object.entries(tank.vdevs)) {
      const min = DISK_VDEV_MIN_MEMBERS[vdev.type]
      const n = Object.keys(vdev.members).length
      if (n < min) {
        return `tank ${tankKey} vdev ${vdevKey} (${vdev.type}) needs ≥${min} members (has ${n})`
      }
    }
  }
  return undefined
}

/**
 * @param {DisksTopology} topology
 * @returns {DisksTopology}
 */
export function ensureMinimalTopology(topology) {
  if (Object.keys(topology.data).length > 0 || Object.keys(topology.tanks).length > 0) {
    return topology
  }
  return {
    data: {},
    tanks: {
      tank: {
        mount: '/tank',
        passphrase: { kind: 'static', value: 'lab-tank-passphrase' },
        options: null,
        vdevs: {
          data: { role: 'data', type: 'single', memberKeys: ['data1'] },
        },
      },
    },
  }
}

/**
 * @param {DiskAttachment} att
 * @returns {DisksMemberInput}
 */
function attachmentToYaml(att) {
  /** @type {DisksMemberInput} */
  const out = {}
  if (att.kind === 'virtual') {
    if (att.size) out.size = att.size
  } else if (att.id) {
    out.id = att.id
  }
  return out
}

/**
 * Shared structure for common.yaml (mounts / vdevs / passphrase; no sizes or physical ids).
 * @param {DisksTopology} topology
 * @returns {DisksInput}
 */
export function topologyToPlain(topology) {
  /** @type {NonNullable<DisksInput['data']>} */
  const data = {}
  for (const [key, vol] of Object.entries(topology.data)) {
    /** @type {DisksDataVolumeInput} */
    const entry = { mount: vol.mount }
    if (vol.fs) entry.fs = vol.fs
    data[key] = entry
  }

  /** @type {NonNullable<DisksInput['tanks']>} */
  const tanks = {}
  for (const [key, tank] of Object.entries(topology.tanks)) {
    /** @type {NonNullable<DisksInput['tanks']>[string]['vdevs']} */
    const vdevs = {}
    for (const [vk, vdev] of Object.entries(tank.vdevs)) {
      /** @type {Record<string, DisksMemberInput>} */
      const members = {}
      for (const mk of vdev.memberKeys) {
        members[mk] = {}
      }
      vdevs[vk] = { role: vdev.role, type: vdev.type, members }
    }
    /** @type {NonNullable<DisksInput['tanks']>[string]} */
    const entry = { mount: tank.mount, vdevs }
    if (tank.passphrase.kind !== 'omit') entry.passphrase = `__PASS__:${key}`
    if (tank.options) entry.options = tank.options
    tanks[key] = entry
  }

  /** @type {DisksInput} */
  const out = {}
  if (Object.keys(data).length > 0) out.data = data
  if (Object.keys(tanks).length > 0) out.tanks = tanks
  return out
}

/**
 * Profile-overlay overrides when topology lives in common: size (virtual) / id (physical) only.
 * @param {EnvDisksAnswers} disks
 * @returns {DisksAttachmentOverlay}
 */
export function envAttachmentsToPlain(disks) {
  /** @type {NonNullable<DisksAttachmentOverlay['data']>} */
  const data = {}
  for (const [key, vol] of Object.entries(disks.data)) {
    data[key] = attachmentToYaml(vol.disk)
  }

  /** @type {NonNullable<DisksAttachmentOverlay['tanks']>} */
  const tanks = {}
  for (const [key, tank] of Object.entries(disks.tanks)) {
    /** @type {NonNullable<DisksAttachmentOverlay['tanks']>[string]['vdevs']} */
    const vdevs = {}
    for (const [vk, vdev] of Object.entries(tank.vdevs)) {
      /** @type {Record<string, DisksMemberInput>} */
      const members = {}
      for (const [mk, mem] of Object.entries(vdev.members)) {
        members[mk] = attachmentToYaml(mem)
      }
      vdevs[vk] = { members }
    }
    tanks[key] = { vdevs }
  }

  /** @type {DisksAttachmentOverlay} */
  const out = { os: /** @type {DisksOsInput} */ (attachmentToYaml(disks.os)) }
  if (Object.keys(data).length > 0) out.data = data
  if (Object.keys(tanks).length > 0) out.tanks = tanks
  return out
}

/**
 * Full disks: block for a single env YAML (structure + attachments).
 * @param {EnvDisksAnswers} disks
 * @returns {DisksInput}
 */
export function envDisksToPlain(disks) {
  /** @type {NonNullable<DisksInput['data']>} */
  const data = {}
  for (const [key, vol] of Object.entries(disks.data)) {
    /** @type {DisksDataVolumeInput} */
    const entry = { mount: vol.mount, ...attachmentToYaml(vol.disk) }
    if (vol.fs) entry.fs = vol.fs
    data[key] = entry
  }

  /** @type {NonNullable<DisksInput['tanks']>} */
  const tanks = {}
  for (const [key, tank] of Object.entries(disks.tanks)) {
    /** @type {NonNullable<DisksInput['tanks']>[string]['vdevs']} */
    const vdevs = {}
    for (const [vk, vdev] of Object.entries(tank.vdevs)) {
      /** @type {Record<string, DisksMemberInput>} */
      const members = {}
      for (const [mk, mem] of Object.entries(vdev.members)) {
        members[mk] = attachmentToYaml(mem)
      }
      vdevs[vk] = { role: vdev.role, type: vdev.type, members }
    }
    /** @type {NonNullable<DisksInput['tanks']>[string]} */
    const entry = { mount: tank.mount, vdevs }
    if (tank.passphrase.kind !== 'omit') entry.passphrase = `__PASS__:${key}`
    if (tank.options) entry.options = tank.options
    tanks[key] = entry
  }

  /** @type {DisksInput} */
  const out = { os: /** @type {DisksOsInput} */ (attachmentToYaml(disks.os)) }
  if (Object.keys(data).length > 0) out.data = data
  if (Object.keys(tanks).length > 0) out.tanks = tanks
  return out
}

/**
 * @param {string} text
 * @param {Record<string, { passphrase: CredentialBinding }>} tanks
 * @returns {string}
 */
function injectPassphraseMarkers(text, tanks) {
  let out = text
  for (const [key, tank] of Object.entries(tanks)) {
    if (tank.passphrase.kind === 'omit') continue
    const marker = `__PASS__:${key}`
    const value = formatYamlValue(tank.passphrase)
    out = out.replaceAll(`'${marker}'`, value).replaceAll(`"${marker}"`, value)
    out = out.replaceAll(marker, value)
  }
  return out
}

/**
 * @param {EnvDisksAnswers} disks
 * @returns {string}
 */
export function renderEnvDisksYaml(disks) {
  const text = YAML.stringify({ disks: envDisksToPlain(disks) }, { lineWidth: 100 })
  return injectPassphraseMarkers(text, disks.tanks)
}

/** @typedef {'virtual' | 'physical' | 'mixed'} DiskBackingMode */

/**
 * @param {BindingPrompts} p
 * @param {string} message
 * @returns {Promise<DiskBackingMode | symbol>}
 */
async function promptBackingMode(p, message) {
  const mode = await p.select({
    message,
    options: [
      { value: 'virtual', label: 'All virtual', hint: 'sized images' },
      { value: 'physical', label: 'All physical', hint: 'host disk ids' },
      { value: 'mixed', label: 'Mixed', hint: 'choose per disk' },
    ],
    initialValue: 'virtual',
  })
  if (p.isCancel(mode)) return /** @type {symbol} */ (mode)
  return mode
}

/**
 * @param {BindingPrompts} p
 * @param {{
 *   label: string
 *   key: string
 *   defaultSize?: string
 *   kind?: 'virtual' | 'physical'
 * }} opts
 * @returns {Promise<DiskAttachment | symbol>}
 */
async function promptAttachment(p, opts) {
  /** @type {'virtual' | 'physical'} */
  let kind
  if (opts.kind) {
    kind = opts.kind
  } else {
    const picked = await p.select({
      message: `${opts.label}: backing`,
      options: [
        { value: 'virtual', label: 'Virtual', hint: 'sized image' },
        { value: 'physical', label: 'Physical', hint: 'host disk id' },
      ],
      initialValue: 'virtual',
    })
    if (typeof picked === 'symbol' || p.isCancel(picked)) {
      return /** @type {symbol} */ (picked)
    }
    kind = picked
  }

  if (kind === 'virtual') {
    const size = await p.text({
      message: `${opts.label}: size`,
      initialValue: opts.defaultSize ?? '20G',
      validate: (/** @type {string | undefined} */ v) =>
        v && String(v).trim() ? undefined : 'Size required for virtual disks',
    })
    if (p.isCancel(size)) return /** @type {symbol} */ (size)
    return { kind: 'virtual', size: String(size).trim() }
  }

  const id = await p.text({
    message: `${opts.label}: physical id (empty → placeholder)`,
    placeholder: physicalIdPlaceholder(opts.key),
  })
  if (p.isCancel(id)) return /** @type {symbol} */ (id)
  const trimmed = String(id ?? '').trim()
  return {
    kind: 'physical',
    id: trimmed || physicalIdPlaceholder(opts.key),
  }
}

/**
 * Vdev layout: name → role → type → members.
 * When `attach`, size/id is asked immediately after each member name (same flow;
 * attach steps are skipped when `attach` is false).
 *
 * @param {BindingPrompts} p
 * @param {WizardScope} [scope]
 * @param {{
 *   attach?: boolean
 *   tankKey?: string
 *   kind?: 'virtual' | 'physical'
 * }} [opts]
 * @returns {Promise<
 *   | { topology: Record<string, VdevTopology>, answers?: Record<string, VdevAnswers> }
 *   | symbol
 * >}
 */
async function promptVdevTopology(p, scope = {}, opts = {}) {
  /** @param {string} message */
  const q = (message) => wizardScoped(scope, message)
  const attach = opts.attach === true
  const tankKey = opts.tankKey ?? 'tank'
  /** @type {Record<string, VdevTopology>} */
  const vdevs = {}
  /** @type {Record<string, VdevAnswers>} */
  const answers = {}
  let first = true
  let addMore = true
  while (addMore) {
    const vdevKey = await p.text({
      message: q(first ? 'Vdev name' : 'Next vdev name'),
      initialValue: first ? 'data' : '',
      validate: (/** @type {string | undefined} */ v) => {
        if (!v || !String(v).trim()) return 'Name required'
        const k = String(v).trim()
        if (vdevs[k]) return `Vdev ${k} already added`
        return undefined
      },
    })
    if (p.isCancel(vdevKey)) return /** @type {symbol} */ (vdevKey)
    const vk = String(vdevKey).trim()

    const role = await p.select({
      message: q(`Role for vdev ${vk}`),
      options: DISK_VDEV_ROLES.map((r) => ({ value: r, label: r })),
      initialValue: 'data',
    })
    if (p.isCancel(role)) return /** @type {symbol} */ (role)

    const type = await p.select({
      message: q(`Type for vdev ${vk}`),
      options: DISK_VDEV_TYPES.map((t) => ({
        value: t,
        label: t,
        hint: `≥${DISK_VDEV_MIN_MEMBERS[t]} members`,
      })),
      // raidz (= raidz1) min 2 — Enter-through yields a small valid lab tank
      initialValue: 'raidz',
    })
    if (p.isCancel(type)) return /** @type {symbol} */ (type)
    const vtype = /** @type {VdevTopology['type']} */ (type)
    const min = DISK_VDEV_MIN_MEMBERS[vtype]

    /** @type {string[]} */
    const memberKeys = []
    /** @type {Record<string, DiskAttachment>} */
    const members = {}

    /**
     * @param {string} message
     * @param {string} [initialValue]
     * @returns {Promise<string | symbol>}
     */
    const promptMember = async (message, initialValue) => {
      const memName = await p.text({
        message: q(message),
        ...(initialValue != null ? { initialValue } : {}),
        validate: (/** @type {string | undefined} */ v) => {
          if (!v || !String(v).trim()) return 'Required'
          if (memberKeys.includes(String(v).trim())) return 'Already added'
          return undefined
        },
      })
      if (p.isCancel(memName)) return /** @type {symbol} */ (memName)
      const mk = String(memName).trim()
      memberKeys.push(mk)
      if (attach) {
        const att = await promptAttachment(p, {
          label: q(`Tank ${tankKey} / ${vk} / ${mk}`),
          key: mk,
          defaultSize: '2G',
          kind: opts.kind,
        })
        if (typeof att === 'symbol') return /** @type {symbol} */ (att)
        members[mk] = att
      }
      return mk
    }

    for (let i = 1; i <= min; i++) {
      const mk = await promptMember(`Member ${i}/${min} name for vdev ${vk}`, `${vk}${i}`)
      if (typeof mk === 'symbol') return mk
    }

    let moreMembers = true
    while (moreMembers) {
      const addMem = await p.confirm({
        message: q(`Add another member to vdev ${vk}? (have ${memberKeys.length})`),
        initialValue: false,
      })
      if (p.isCancel(addMem)) return /** @type {symbol} */ (addMem)
      if (!addMem) {
        moreMembers = false
        break
      }
      const mk = await promptMember(`Extra member name for vdev ${vk}`)
      if (typeof mk === 'symbol') return mk
    }

    const roleTyped = /** @type {VdevTopology['role']} */ (role)
    vdevs[vk] = { role: roleTyped, type: vtype, memberKeys }
    if (attach) answers[vk] = { role: roleTyped, type: vtype, members }
    first = false

    const more = await p.confirm({
      message: q('Add another vdev?'),
      initialValue: false,
    })
    if (p.isCancel(more)) return /** @type {symbol} */ (more)
    addMore = Boolean(more)
  }
  return { topology: vdevs, ...(attach ? { answers } : {}) }
}

/**
 * Single disks flow. Steps run in fixed order; `askStructure` / `askAttachments`
 * only skip irrelevant parts (define topology vs size/id).
 *
 * Order: backing mode → OS → data volumes → tanks (vdev members + size/id).
 * When structure is skipped, existing `topology` is used and only attach steps run.
 *
 * @param {{
 *   prompts?: BindingPrompts
 *   scope?: WizardScope
 *   offerVwVolume?: boolean
 *   topology?: DisksTopology
 *   askStructure?: boolean
 *   askAttachments?: boolean
 * }} opts
 * @returns {Promise<{ topology: DisksTopology, disks?: EnvDisksAnswers } | symbol>}
 */
export async function promptDisksScope(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const scope = opts.scope ?? {}
  /** @param {string} message */
  const q = (message) => wizardScoped(scope, message)
  const askStructure = opts.askStructure ?? opts.topology == null
  const askAttachments = opts.askAttachments !== false

  wizardStep(
    p,
    q(askStructure && askAttachments ? 'Disks' : askStructure ? 'Disk topology' : 'Disk backing'),
  )

  /** @type {DiskBackingMode | undefined} */
  let profileMode
  /** @type {'virtual' | 'physical' | undefined} */
  let uniformKind

  // --- Backing mode (skip if not attaching) ---
  if (askAttachments) {
    const mode = await promptBackingMode(p, q('Disks: all virtual, all physical, or mixed?'))
    if (typeof mode === 'symbol') return mode
    profileMode = mode
    uniformKind = mode === 'mixed' ? undefined : mode
  }

  /** @type {DiskAttachment | undefined} */
  let os
  /** @type {Record<string, DataVolumeTopology>} */
  const data = {}
  /** @type {Record<string, DataVolumeAnswers>} */
  const dataAns = {}
  /** @type {Record<string, TankTopology>} */
  const tanks = {}
  /** @type {Record<string, TankAnswers>} */
  const tanksAns = {}

  // --- OS (skip if not attaching) ---
  if (askAttachments) {
    const osAtt = await promptAttachment(p, {
      label: q('OS disk'),
      key: 'os',
      defaultSize: '20G',
      kind: uniformKind,
    })
    if (typeof osAtt === 'symbol') return /** @type {symbol} */ (osAtt)
    os = osAtt
  }

  // --- Data volumes: define and/or attach ---
  if (askStructure) {
    if (opts.offerVwVolume) {
      const addVw = await p.confirm({
        message: q('Add data volume vw → /vw (Vaultwarden)?'),
        initialValue: true,
      })
      if (p.isCancel(addVw)) return /** @type {symbol} */ (addVw)
      if (addVw) {
        data.vw = { mount: '/vw' }
        if (askAttachments) {
          const disk = await promptAttachment(p, {
            label: q('Data vw (/vw)'),
            key: 'vw',
            defaultSize: '2G',
            kind: uniformKind,
          })
          if (typeof disk === 'symbol') return /** @type {symbol} */ (disk)
          dataAns.vw = { mount: '/vw', disk }
        }
      }
    }

    let addData = true
    while (addData) {
      const moreData = await p.confirm({
        message: q(
          Object.keys(data).length === 0 ? 'Add a data volume?' : 'Add another data volume?',
        ),
        // Prefer a tank over plain data volumes when accepting defaults (Enter).
        initialValue: false,
      })
      if (p.isCancel(moreData)) return /** @type {symbol} */ (moreData)
      if (!moreData) {
        addData = false
        break
      }

      const key = await p.text({
        message: q('Data volume name'),
        validate: (/** @type {string | undefined} */ v) => {
          if (!v || !String(v).trim()) return 'Required'
          if (data[String(v).trim()]) return 'Already added'
          return undefined
        },
      })
      if (p.isCancel(key)) return /** @type {symbol} */ (key)
      const dk = String(key).trim()

      const mount = await p.text({
        message: q(`Mount for ${dk}`),
        initialValue: `/${dk}`,
        validate: (/** @type {string | undefined} */ v) =>
          v && String(v).trim().startsWith('/') ? undefined : 'Absolute mount path required',
      })
      if (p.isCancel(mount)) return /** @type {symbol} */ (mount)

      const fsAns = await p.text({
        message: q(`Filesystem for ${dk} (empty = platform default)`),
        initialValue: '',
      })
      if (p.isCancel(fsAns)) return /** @type {symbol} */ (fsAns)

      /** @type {DataVolumeTopology} */
      const vol = { mount: String(mount).trim() }
      const fs = String(fsAns ?? '').trim()
      if (fs) vol.fs = fs
      data[dk] = vol

      if (askAttachments) {
        const disk = await promptAttachment(p, {
          label: q(`Data ${dk} (${vol.mount})`),
          key: dk,
          defaultSize: dk === 'vw' ? '2G' : '10G',
          kind: uniformKind,
        })
        if (typeof disk === 'symbol') return /** @type {symbol} */ (disk)
        /** @type {DataVolumeAnswers} */
        const entry = { mount: vol.mount, disk }
        if (vol.fs) entry.fs = vol.fs
        dataAns[dk] = entry
      }
    }
  } else if (askAttachments) {
    // Structure already known — only size/id for each data volume.
    if (!opts.topology)
      throw new Error('promptDisksScope: topology required when askStructure is false')
    for (const [key, vol] of Object.entries(opts.topology.data)) {
      const disk = await promptAttachment(p, {
        label: q(`Data ${key} (${vol.mount})`),
        key,
        defaultSize: key === 'vw' ? '2G' : '10G',
        kind: uniformKind,
      })
      if (typeof disk === 'symbol') return /** @type {symbol} */ (disk)
      /** @type {DataVolumeAnswers} */
      const entry = { mount: vol.mount, disk }
      if (vol.fs) entry.fs = vol.fs
      dataAns[key] = entry
    }
  }

  // --- Tanks: define and/or attach ---
  if (askStructure) {
    let addTank = true
    while (addTank) {
      const moreTank = await p.confirm({
        message: q(Object.keys(tanks).length === 0 ? 'Add a ZFS tank?' : 'Add another tank?'),
        initialValue: Object.keys(tanks).length === 0,
      })
      if (p.isCancel(moreTank)) return /** @type {symbol} */ (moreTank)
      if (!moreTank) {
        addTank = false
        break
      }

      const key = await p.text({
        message: q('Tank / pool name'),
        initialValue: Object.keys(tanks).length === 0 ? 'tank' : '',
        validate: (/** @type {string | undefined} */ v) => {
          if (!v || !String(v).trim()) return 'Required'
          if (tanks[String(v).trim()]) return 'Already added'
          return undefined
        },
      })
      if (p.isCancel(key)) return /** @type {symbol} */ (key)
      const tk = String(key).trim()

      const mount = await p.text({
        message: q(`Mount for tank ${tk}`),
        initialValue: `/${tk}`,
        validate: (/** @type {string | undefined} */ v) =>
          v && String(v).trim().startsWith('/') ? undefined : 'Absolute mount path required',
      })
      if (p.isCancel(mount)) return /** @type {symbol} */ (mount)

      const passphrase = await promptCredentialBinding({
        message: q(`Passphrase for tank ${tk}`),
        allowOmit: true,
        omitLabel: 'None (no encryption)',
        initialKind: 'static',
        staticInitial: 'lab-tank-passphrase',
        suggestSecretName: 'TANK_PASSPHRASE',
        askValueNow: true,
        prompts: p,
      })
      if (typeof passphrase === 'symbol') {
        return /** @type {symbol} */ (passphrase)
      }

      /** @type {'virtual' | 'physical' | undefined} */
      let tankKind = uniformKind
      if (askAttachments && profileMode === 'mixed') {
        const tankMode = await promptBackingMode(
          p,
          q(`Tank ${tk} members: all virtual, all physical, or mixed?`),
        )
        if (typeof tankMode === 'symbol') return tankMode
        tankKind = tankMode === 'mixed' ? undefined : tankMode
      }

      const vdevPass = await promptVdevTopology(p, scope, {
        attach: askAttachments,
        tankKey: tk,
        kind: tankKind,
      })
      if (typeof vdevPass === 'symbol') return /** @type {symbol} */ (vdevPass)

      const customizeOpts = await p.confirm({
        message: q('Customize tank pool/dataset/acl options?'),
        initialValue: false,
      })
      if (p.isCancel(customizeOpts)) return /** @type {symbol} */ (customizeOpts)

      /** @type {TankOptionsInput | null} */
      let options = null
      if (customizeOpts) {
        const ashift = await p.text({
          message: q('pool.ashift'),
          initialValue: '12',
          validate: (/** @type {string | undefined} */ v) =>
            v && /^\d+$/.test(String(v).trim()) ? undefined : 'Integer required',
        })
        if (p.isCancel(ashift)) return /** @type {symbol} */ (ashift)
        const compression = await p.text({
          message: q('dataset.compression'),
          initialValue: 'lz4',
          validate: (/** @type {string | undefined} */ v) =>
            v && String(v).trim() ? undefined : 'Required',
        })
        if (p.isCancel(compression)) return /** @type {symbol} */ (compression)
        options = {
          pool: { ashift: Number(String(ashift).trim()) },
          dataset: { compression: String(compression).trim() },
        }
      }

      tanks[tk] = {
        mount: String(mount).trim(),
        passphrase,
        options,
        vdevs: vdevPass.topology,
      }
      if (askAttachments && vdevPass.answers) {
        tanksAns[tk] = {
          mount: String(mount).trim(),
          passphrase,
          options,
          vdevs: vdevPass.answers,
        }
      }
    }
  } else if (askAttachments) {
    // Structure already known — tank mode (if mixed) + size/id per member.
    if (!opts.topology)
      throw new Error('promptDisksScope: topology required when askStructure is false')
    for (const [tk, tank] of Object.entries(opts.topology.tanks)) {
      /** @type {'virtual' | 'physical' | undefined} */
      let tankKind = uniformKind
      if (profileMode === 'mixed') {
        const tankMode = await promptBackingMode(
          p,
          q(`Tank ${tk} members: all virtual, all physical, or mixed?`),
        )
        if (typeof tankMode === 'symbol') return tankMode
        tankKind = tankMode === 'mixed' ? undefined : tankMode
      }

      /** @type {Record<string, VdevAnswers>} */
      const vdevAns = {}
      for (const [vk, vdev] of Object.entries(tank.vdevs)) {
        /** @type {Record<string, DiskAttachment>} */
        const members = {}
        for (const mk of vdev.memberKeys) {
          const att = await promptAttachment(p, {
            label: q(`Tank ${tk} / ${vk} / ${mk}`),
            key: mk,
            defaultSize: '2G',
            kind: tankKind,
          })
          if (typeof att === 'symbol') return /** @type {symbol} */ (att)
          members[mk] = att
        }
        vdevAns[vk] = { role: vdev.role, type: vdev.type, members }
      }
      tanksAns[tk] = {
        mount: tank.mount,
        passphrase: tank.passphrase,
        options: tank.options,
        vdevs: vdevAns,
      }
    }
  }

  /** @type {DisksTopology} */
  const topology = askStructure
    ? ensureMinimalTopology({ data, tanks })
    : (() => {
        if (!opts.topology)
          throw new Error('promptDisksScope: topology required when askStructure is false')
        return opts.topology
      })()

  if (!askAttachments) return { topology }
  if (!os) throw new Error('promptDisksScope: OS attachment missing')
  return { topology, disks: { os, data: dataAns, tanks: tanksAns } }
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   profiles: Record<string, ProfileWriteSpec>
 *   varlockPlugins?: VarlockPluginDep[]
 * }} opts
 * @returns {Promise<DisksWizardAnswers | symbol>}
 */
export async function promptDisks(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const offerVw = (opts.varlockPlugins ?? []).some((x) => x.package === VAULTWARDEN_PLUGIN)
  const profileKeys = Object.keys(opts.profiles).filter((k) => opts.profiles[k])
  if (profileKeys.length === 0) {
    return { sharedStructure: false, byProfile: {} }
  }

  wizardStep(p, 'Disks')
  const share = await p.confirm({
    message:
      profileKeys.length > 1
        ? 'Same disk topology for all profiles? (common.yaml + per-profile size/id)'
        : 'Share disk topology with future profiles? (common.yaml + profile overlays)',
    initialValue: true,
  })
  if (p.isCancel(share)) return /** @type {symbol} */ (share)
  const sharedStructure = Boolean(share)

  /** @type {Record<string, EnvDisksAnswers>} */
  const byProfile = {}

  if (sharedStructure) {
    // One interleaved run for the first profile (topology + its sizes/ids).
    const first = profileKeys[0]
    const firstPass = await promptDisksScope({
      prompts: p,
      scope: { profile: first },
      offerVwVolume: offerVw,
      askStructure: true,
      askAttachments: true,
    })
    if (typeof firstPass === 'symbol') return /** @type {symbol} */ (firstPass)
    if (!firstPass.disks) throw new Error(`promptDisks: missing disks for profile ${first}`)
    byProfile[first] = firstPass.disks
    const topology = firstPass.topology

    for (const profile of profileKeys.slice(1)) {
      const pass = await promptDisksScope({
        prompts: p,
        scope: { profile },
        topology,
        askStructure: false,
        askAttachments: true,
      })
      if (typeof pass === 'symbol') return /** @type {symbol} */ (pass)
      if (!pass.disks) throw new Error(`promptDisks: missing disks for profile ${profile}`)
      byProfile[profile] = pass.disks
    }

    return { sharedStructure: true, topology, byProfile }
  }

  for (const profile of profileKeys) {
    const pass = await promptDisksScope({
      prompts: p,
      scope: { profile },
      offerVwVolume: offerVw,
      askStructure: true,
      askAttachments: true,
    })
    if (typeof pass === 'symbol') return /** @type {symbol} */ (pass)
    if (!pass.disks) throw new Error(`promptDisks: missing disks for profile ${profile}`)
    byProfile[profile] = pass.disks
  }

  return { sharedStructure: false, byProfile }
}

/**
 * @param {string} root
 * @param {string} env
 * @param {EnvDisksAnswers} disks
 */
function applyTankSecrets(root, env, disks) {
  const schemaPath = join(root, 'provision', '.env.schema')
  const envPath = join(root, 'provision', `.env.${env}`)
  let schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '# ---\n'
  let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : `# QCTL_ENV=${env}\n# ---\n`

  for (const tank of Object.values(disks.tanks)) {
    if (tank.passphrase.kind !== 'secret') continue
    schema = ensureSchemaSecret(schema, tank.passphrase.name).text
    if (tank.passphrase.value != null) {
      envText = ensureEnvValue(envText, tank.passphrase.name, tank.passphrase.value).text
    }
  }
  writeFileSync(schemaPath, schema.endsWith('\n') ? schema : `${schema}\n`, 'utf8')
  writeFileSync(envPath, envText.endsWith('\n') ? envText : `${envText}\n`, 'utf8')
}

/**
 * Mutable provision YAML while patching `disks:` (parse is untyped until schema).
 * @typedef {Partial<Omit<ProvisionFileInput, 'disks'>> & {
 *   disks?: DisksInput | DisksAttachmentOverlay
 * }} ProvisionYamlDoc
 */

/**
 * Merge `disks:` into an existing provision YAML (preserves leading comments).
 * @param {string} path
 * @param {DisksInput | DisksAttachmentOverlay} disksPlain
 * @param {Record<string, { passphrase: CredentialBinding }>} [tanksForPass]
 */
function writeDisksPlainIntoYamlFile(path, disksPlain, tanksForPass = {}) {
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
  doc.disks = disksPlain

  let text = header + YAML.stringify(doc, { lineWidth: 100 })
  text = injectPassphraseMarkers(text, tanksForPass)
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/**
 * Apply disk answers: shared topology → common.yaml + size/id overrides per
 * `profile-*.yaml`; otherwise full `disks:` in each profile file.
 * @param {string} root
 * @param {DisksWizardAnswers} answers
 * @param {{ profiles: Record<string, ProfileWriteSpec> }} ctx
 */
export function applyDisksAnswers(root, answers, ctx) {
  if (answers.sharedStructure && answers.topology) {
    const commonPath = join(root, 'provision', 'common.yaml')
    if (!existsSync(commonPath)) {
      writeFileSync(commonPath, `# Shared provision settings for every profile.\n`, 'utf8')
    }
    writeDisksPlainIntoYamlFile(
      commonPath,
      topologyToPlain(answers.topology),
      answers.topology.tanks,
    )
  }

  /** @type {Set<string>} */
  const secretsApplied = new Set()

  for (const [profile, disks] of Object.entries(answers.byProfile)) {
    const spec = ctx.profiles[profile]
    if (!spec || !disks) continue
    const path = join(root, 'provision', `profile-${profile}.yaml`)
    if (!existsSync(path)) {
      writeFileSync(
        path,
        `# Profile "${profile}" (env=${spec.env}, target=${spec.target}) — overrides for this profile only.\n`,
        'utf8',
      )
    }
    if (answers.sharedStructure && answers.topology) {
      writeDisksPlainIntoYamlFile(path, envAttachmentsToPlain(disks))
    } else {
      writeDisksPlainIntoYamlFile(path, envDisksToPlain(disks), disks.tanks)
    }
    if (!secretsApplied.has(spec.env)) {
      applyTankSecrets(root, spec.env, disks)
      secretsApplied.add(spec.env)
    }
  }
}
