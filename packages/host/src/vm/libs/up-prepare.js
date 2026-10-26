/**
 * Shared prep for up / init-tank: download image, disks, seed → {@link VmSpecs}.
 * Host-owned — drivers never see seed profile / forceDownload / wipeOs flags.
 */
import { chalk } from 'zx'

import { loadEnvProvision } from '../../lib/load-config.js'
import { requireBins } from '../../lib/util.js'
import { downloadImage } from '../commands/download.js'
import { clientFrom } from '../drivers/proxmox/shared.js'
import { assertInitTankForceOrFresh, logInitTankPools } from './assert-init-tank-force.js'
import { summarizeAttachModes, withAttachModes } from './attach-mode.js'
import { toInitTankDiskPlan, toVmDiskPlan } from './disk-plan.js'
import { ensureDisks } from './disks.js'
import { ensureInitTankBootDisk } from './init-tank-boot.js'
import { resolveInitTankPools } from './init-tank-pools.js'
import { ensureDefaultNetwork } from './libvirt/index.js'
import { toVmNicsSpec } from './nic-plan.js'
import { ensureCloudImageImport } from './proxmox/vm-images.js'
import { resolveProvisionDisks } from './resolve-provision-disks.js'
import { runSeed } from './seed/run.js'

/**
 * @import {
 *   VmContext,
 *   VmDriverId,
 *   VmDriverRegistration,
 *   VmSeedProfile,
 *   VmSpecs,
 *   VmUpOptions,
 * } from '../driver-contract.js'
 */

/**
 * Host-only prep knobs (not {@link VmUpOptions}).
 * @typedef {object} HostCreatePrep
 * @property {VmSeedProfile} seedProfile
 * @property {boolean} [forceDownload]
 * @property {boolean} [wipeOs]  ensureDisks OS recreate only (after host destroy)
 * @property {string[]} [poolIds]
 * @property {boolean} [force]  init-tank tank recreate
 */

/**
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @returns {Promise<void>}
 */
export async function prepareHostForUp(module, ctx) {
  const id = String(module.id)
  if (id === 'workstation') {
    await requireBins(['virt-install', 'virsh', 'qemu-img', 'swtpm'])
    await ensureDefaultNetwork(ctx.connect || 'qemu:///system')
    return
  }
  if (id === 'proxmox') {
    await module.ensureHostReady?.(ctx)
  }
}

/**
 * Download / import cloud image → path or PVE volid for the boot disk `image`.
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @param {{ forceDownload?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function resolveBaseOsImage(module, ctx, opts = {}) {
  const id = String(module.id)
  if (id === 'proxmox') {
    const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
    return ensureCloudImageImport(client, { force: Boolean(opts.forceDownload) })
  }
  return downloadImage({
    force: Boolean(opts.forceDownload),
    env: ctx.env || 'dev',
    target: 'workstation',
  })
}

/**
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @param {HostCreatePrep} prep
 * @returns {Promise<void>}
 */
export async function dryRunUp(module, ctx, prep) {
  const target = String(module.id)
  console.log(
    chalk.dim(
      `vm: dry-run up target=${target} name=${ctx.name} seed=${prep.seedProfile} `
        + `wipeOs=${Boolean(prep.wipeOs)}`,
    ),
  )
  if (ctx.profile == null || String(ctx.profile).trim() === '') return
  try {
    const resolved = await resolveProvisionDisks({
      env: ctx.env || 'dev',
      target,
      profile: ctx.profile,
    })
    console.log(chalk.dim(`  disks: ${summarizeAttachModes(withAttachModes(resolved.members))}`))
  } catch {
    /* soft — dry-run should not die on missing provision in unit tests */
  }
}

/**
 * Ensure local disks for workstation before create. Uses host-resolved baseOsImage.
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @param {HostCreatePrep} prep
 * @param {string} baseOsImage
 * @returns {Promise<{ bootDiskPath?: string }>}
 */
export async function ensureDisksForCreate(module, ctx, prep, baseOsImage) {
  const target = String(module.id)
  if (target !== 'workstation') return {}

  const connect = ctx.connect || 'qemu:///system'
  const name = ctx.name
  const resolved = await resolveProvisionDisks({
    env: ctx.env || 'dev',
    target,
    profile: ctx.profile,
  })
  console.log(
    chalk.dim(
      `  connect=${connect}; disks: ${summarizeAttachModes(withAttachModes(resolved.members))}`,
    ),
  )

  if (prep.seedProfile === 'init-tank') {
    const selection = resolveInitTankPools(resolved, prep.poolIds)
    if (!selection) {
      console.log(chalk.yellow('vm: init-tank: no disks.tanks in provision — nothing to create'))
      return {}
    }
    logInitTankPools(selection.poolIds)
    assertInitTankForceOrFresh({
      name,
      members: selection.members,
      force: Boolean(prep.force),
    })
    await ensureDisks({
      name,
      baseImage: baseOsImage,
      resolved,
      wipeOs: false,
      wipeTank: Boolean(prep.force),
      wipeTankIds: selection.memberIds,
      dryRun: false,
    })
    const bootDiskPath = await ensureInitTankBootDisk({
      name,
      baseImage: baseOsImage,
      size: resolved.os.size,
    })
    return { bootDiskPath }
  }

  await ensureDisks({
    name,
    baseImage: baseOsImage,
    resolved,
    wipeOs: Boolean(prep.wipeOs),
    wipeTank: false,
    dryRun: false,
  })
  return {}
}

/**
 * Build full {@link VmSpecs} from soft argv specs + host prep (seed + disks).
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @param {Partial<VmSpecs>} soft  memory/vcpus from argv (+ optional osinfo)
 * @param {HostCreatePrep} prep
 * @param {string} baseOsImage
 * @param {{ bootDiskPath?: string }} [diskExtras]
 * @returns {Promise<VmSpecs>}
 */
export async function buildCreateSpec(module, ctx, soft, prep, baseOsImage, diskExtras = {}) {
  if (soft.memory == null || soft.vcpus == null) {
    throw new Error('buildCreateSpec: memory and vcpus are required')
  }
  const target = String(/** @type {VmDriverId} */ (module.id))
  const seedProfile = prep.seedProfile
  console.log(chalk.cyan(`vm: building ${seedProfile} seed…`))
  const seed = await runSeed({
    seedProfile,
    profile: ctx.profile,
    allowMissingTier0: false,
    allowMissingFiles: false,
    env: ctx.env || 'dev',
    target,
    ...(seedProfile === 'init-tank'
      ? {
          initTankPools: prep.poolIds,
          initTankForce: Boolean(prep.force),
        }
      : {}),
  })
  const resolved = await resolveProvisionDisks({
    env: ctx.env || 'dev',
    target,
    profile: ctx.profile,
  })
  const name = String(ctx.name).trim()
  const plan =
    seedProfile === 'init-tank' && diskExtras.bootDiskPath
      ? toInitTankDiskPlan(name, resolved, {
          baseOsImage,
          bootDiskPath: diskExtras.bootDiskPath,
        })
      : toVmDiskPlan(name, resolved, { baseOsImage })
  const seedIsoPath = seed.isoPath
  if (!seedIsoPath) throw new Error('buildCreateSpec: seed ISO path missing')
  if (!plan.disks || !Object.keys(plan.disks).length) {
    throw new Error('buildCreateSpec: disks plan is empty')
  }
  if (ctx.profile == null || String(ctx.profile).trim() === '') {
    throw new Error('buildCreateSpec: profile is required for NIC plan')
  }
  const provision = await loadEnvProvision({
    env: ctx.env || 'dev',
    target,
    profile: ctx.profile,
  })
  const nics = toVmNicsSpec(provision.interfaces)
  return {
    memory: soft.memory,
    vcpus: soft.vcpus,
    osinfo: soft.osinfo,
    disks: plan.disks,
    bootDrive: plan.bootDrive,
    seedIsoPath,
    ...(Object.keys(nics).length ? { nics } : {}),
  }
}

/**
 * Merge provision NIC plan onto a soft reconcile patch (installed `vm up`).
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @param {Partial<VmSpecs>} soft
 * @returns {Promise<Partial<VmSpecs>>}
 */
export async function enrichSpecsWithNics(module, ctx, soft) {
  if (soft.nics) return soft
  if (ctx.profile == null || String(ctx.profile).trim() === '') return soft
  try {
    const provision = await loadEnvProvision({
      env: ctx.env || 'dev',
      target: String(/** @type {VmDriverId} */ (module.id)),
      profile: ctx.profile,
    })
    const nics = toVmNicsSpec(provision.interfaces)
    if (!Object.keys(nics).length) return soft
    return { ...soft, nics }
  } catch {
    return soft
  }
}
