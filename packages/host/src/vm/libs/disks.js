/**
 * Local libvirt disk paths + ensure (attach-mode: size → virtual, else physical).
 */
import { existsSync } from 'node:fs'

import { $, chalk, fs, path } from 'zx'

import { getVms } from '../../lib/paths.js'
import { requireBins } from '../../lib/util.js'
import { assertLocalAttachModes, byIdPath, withAttachModes } from './attach-mode.js'

/** @import { ResolvedDiskMember, ResolvedDisks } from '../../provision/schema/resolve-disks.js' */
/** @import { DiskWithAttachMode } from './attach-mode.js' */

/**
 * @typedef {object} VmDiskEntry
 * @property {string} id
 * @property {string} path qcow or by-id device
 * @property {'os' | 'data' | 'tank'} kind
 * @property {string} [size]
 * @property {'virtual' | 'physical'} mode
 * @property {string} [owner]
 * @property {'data' | 'special'} [role]
 */

/**
 * @typedef {object} VmDiskPaths
 * @property {string} dir
 * @property {VmDiskEntry} os
 * @property {VmDiskEntry[]} attached non-OS disks (data + tank members), attach order
 * @property {DiskWithAttachMode[]} members resolved members with attach mode (os + attached)
 */

/**
 * @param {string} name
 * @param {ResolvedDiskMember[]} members
 * @returns {VmDiskPaths}
 */
export function vmPathsFromMembers(name, members) {
  const dir = path.join(getVms(), name)
  const classified = withAttachModes(members)
  /** @type {VmDiskEntry[]} */
  const entries = []
  for (const m of classified) {
    const qcow = path.join(dir, `${m.id}.qcow2`)
    const useById = m.mode === 'physical' && existsSync(byIdPath(m.id))
    entries.push({
      id: m.id,
      path: useById ? byIdPath(m.id) : qcow,
      kind: m.kind,
      mode: m.mode,
      ...(m.size ? { size: m.size } : {}),
      ...(m.owner ? { owner: m.owner } : {}),
      ...(m.role ? { role: m.role } : {}),
    })
  }
  const os = entries.find((e) => e.kind === 'os')
  if (!os) throw new Error('vmPathsFromMembers: missing os member')
  return {
    dir,
    os,
    attached: entries.filter((e) => e.kind !== 'os'),
    members: classified,
  }
}

/**
 * @param {string} name
 * @param {ResolvedDisks} resolved
 * @returns {VmDiskPaths}
 */
export function vmPaths(name, resolved) {
  return vmPathsFromMembers(name, resolved.members)
}

/**
 * Non-OS qcow paths (data + tank members). Kept across --keep-persistent / --wipe-os.
 * @param {VmDiskPaths} p
 * @returns {string[]}
 */
export function persistentDisks(p) {
  return p.attached.map((e) => e.path).filter((f) => f.endsWith('.qcow2'))
}

/**
 * @param {string} file
 * @param {string} size
 * @param {string} label
 */
async function ensureQcow(file, size, label) {
  if (fs.existsSync(file)) {
    console.log(chalk.dim(`vm: keep ${label} ${file}`))
    return
  }
  console.log(chalk.cyan(`vm: ${label} ${size} → ${file}`))
  await $`qemu-img create -f qcow2 ${file} ${size}`
}

/**
 * @param {{
 *   name: string,
 *   baseImage: string,
 *   resolved: ResolvedDisks,
 *   wipeOs?: boolean,
 *   wipeTank?: boolean,
 *   wipeTankIds?: string[],
 *   dryRun?: boolean,
 * }} opts
 * @returns {Promise<VmDiskPaths>}
 */
export async function ensureDisks({
  name,
  baseImage,
  resolved,
  wipeOs,
  wipeTank,
  wipeTankIds,
  dryRun,
}) {
  const p = vmPaths(name, resolved)
  assertLocalAttachModes(p.members, {
    qcowPath: (id) => path.join(p.dir, `${id}.qcow2`),
  })

  /** @type {Set<string>} */
  const wipeMembers = new Set(wipeTankIds || [])
  if (wipeTank) {
    for (const e of p.attached) {
      if (e.kind === 'tank') wipeMembers.add(e.id)
    }
  }

  if (dryRun) {
    const flags = [
      wipeOs ? 'wipe disks.os' : null,
      wipeMembers.size ? `wipe tank members ${[...wipeMembers].join(',')}` : null,
    ].filter(Boolean)
    console.log(
      chalk.dim(
        `vm: would ensure under ${p.dir}: `
          + p.members.map((m) => `${m.id}:${m.mode === 'virtual' ? m.size : 'physical'}`).join(', ')
          + (flags.length ? ` (${flags.join('; ')})` : ''),
      ),
    )
    return p
  }
  await requireBins(['qemu-img'])
  await fs.mkdirp(p.dir)

  // --wipe-os: only disks.os (never data / tank members).
  if (wipeOs && fs.existsSync(p.os.path) && p.os.path.endsWith('.qcow2')) {
    console.log(chalk.yellow(`vm: wiping OS disk ${p.os.path}`))
    await fs.remove(p.os.path)
  }

  if (p.os.mode === 'virtual') {
    if (!fs.existsSync(p.os.path)) {
      console.log(chalk.cyan(`vm: OS overlay → ${p.os.path}`))
      await $`qemu-img create -f qcow2 -F qcow2 -b ${baseImage} ${p.os.path}`
      if (p.os.size) await $`qemu-img resize ${p.os.path} ${p.os.size}`
    } else {
      console.log(chalk.dim(`vm: keep OS ${p.os.path}`))
    }
  } else if (!fs.existsSync(p.os.path)) {
    throw new Error(`disks: physical OS ${p.os.path} missing`)
  } else {
    console.log(chalk.dim(`vm: keep physical OS ${p.os.path}`))
  }

  for (const e of p.attached) {
    if (e.kind !== 'tank' || !wipeMembers.has(e.id)) continue
    if (e.path.endsWith('.qcow2') && fs.existsSync(e.path)) {
      console.log(chalk.yellow(`vm: wipe tank disk ${e.path}`))
      await fs.remove(e.path)
    }
  }

  for (const e of p.attached) {
    if (e.mode === 'physical') {
      console.log(chalk.dim(`vm: keep physical ${e.id} ${e.path}`))
      continue
    }
    if (!e.size) throw new Error(`disks: virtual ${e.id} missing size`)
    await ensureQcow(e.path, e.size, e.id)
  }
  return p
}
