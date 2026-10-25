/**
 * Map provision {@link ResolvedDisks} → disk fields on {@link VmSpecs}.
 * Product roles (os/tank/data) stay here; drivers only see labels + {@link VmDiskSpec.type}.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { getVms } from '../../lib/paths.js'
import { byIdPath, withAttachMode } from './attach-mode.js'
import { INIT_TANK_BOOT_ID } from './init-tank-boot.js'

/** @import { ResolvedDisks } from '../../provision/schema/resolve-disks.js' */
/** @import { VmDiskSpec, VmDisksSpec, VmSpecs } from '../driver-contract.js' */

/** @typedef {Pick<VmSpecs, 'disks' | 'bootDrive'>} VmDiskPlanSlice */

/**
 * Labels that survive `--keep-persistent` / wipe-os (everything except os).
 * @param {ResolvedDisks} resolved
 * @returns {string[]}
 */
export function persistentDiskLabels(resolved) {
  return resolved.members.filter((m) => m.kind !== 'os').map((m) => m.id)
}

/**
 * @param {string} name
 * @param {string} label
 * @returns {string}
 */
export function defaultQcowPath(name, label) {
  return join(getVms(), name, `${label}.qcow2`)
}

/**
 * @param {string} name
 * @param {ResolvedDisks} resolved
 * @param {{
 *   baseOsImage?: string,
 *   bootDrive?: string,
 *   prepend?: VmDisksSpec,
 *   omitLabels?: Iterable<string>,
 * }} [opts]
 * @returns {VmDiskPlanSlice}
 */
export function toVmDiskPlan(name, resolved, opts = {}) {
  const omit = new Set([...(opts.omitLabels ?? [])].map(String))
  /** @type {VmDisksSpec} */
  const disks = { ...(opts.prepend ?? {}) }

  for (const raw of resolved.members) {
    if (omit.has(raw.id)) continue
    const m = withAttachMode(raw)
    const qcow = defaultQcowPath(name, m.id)
    const useById = m.mode === 'physical' && existsSync(byIdPath(m.id))

    /** @type {VmDiskSpec} */
    let spec
    if (useById || m.mode === 'physical') {
      spec = {
        type: 'physical',
        path: useById ? byIdPath(m.id) : qcow,
        format: useById ? 'raw' : 'qcow2',
      }
    } else {
      if (!m.size) {
        throw new Error(`toVmDiskPlan: virtual disk ${m.id} needs size`)
      }
      spec = {
        type: 'virtual',
        path: qcow,
        format: 'qcow2',
        size: m.size,
        ...(m.kind === 'os' && opts.baseOsImage ? { image: opts.baseOsImage } : {}),
      }
    }
    disks[m.id] = spec
  }

  const bootDrive =
    opts.bootDrive
    ?? (resolved.os.id in disks ? resolved.os.id : undefined)
    ?? Object.keys(disks)[0]

  return { disks, ...(bootDrive ? { bootDrive } : {}) }
}

/**
 * Init-tank plan: disposable boot first, then non-os members; omit provision os.
 * @param {string} name
 * @param {ResolvedDisks} resolved
 * @param {{ baseOsImage: string, bootDiskPath: string, bootLabel?: string }} opts
 * @returns {VmDiskPlanSlice}
 */
export function toInitTankDiskPlan(name, resolved, opts) {
  const bootLabel = opts.bootLabel ?? INIT_TANK_BOOT_ID
  const size = resolved.os.size
  if (!size) {
    throw new Error('toInitTankDiskPlan: OS size is required for disposable boot')
  }
  /** @type {VmDisksSpec} */
  const prepend = {
    [bootLabel]: {
      type: 'virtual',
      path: opts.bootDiskPath,
      format: 'qcow2',
      size,
      image: opts.baseOsImage,
    },
  }
  return toVmDiskPlan(name, resolved, {
    baseOsImage: opts.baseOsImage,
    bootDrive: bootLabel,
    prepend,
    omitLabels: [resolved.os.id],
  })
}
