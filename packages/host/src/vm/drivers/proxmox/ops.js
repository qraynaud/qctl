/**
 * Thin Proxmox hypervisor ops for {@link VmDriverModule}.
 */
import { chalk, fs } from 'zx'

import { die } from '../../../lib/util.js'
import { proxmoxSchema } from '../../../provision/schema/targets.js'
import { INIT_TANK_BOOT_ID } from '../../libs/init-tank-boot.js'
import {
  destroyHolder,
  holderVmName,
  loadDisksFromHolder,
  promoteHolderToAppliance,
} from '../../libs/proxmox/disk-holder.js'
import {
  attachInitTankBootOnAppliance,
  removeInitTankBootDisks,
} from '../../libs/proxmox/init-tank-boot.js'
import { startProxmoxSerialFollow } from '../../libs/proxmox/serial.js'
import {
  createRockyVm,
  destroyRockyVm,
  detachAndDeleteSeedIso,
  disksWithReuseVolids,
  reconcileRockyAppliance,
  restoreProxmoxDisplay,
  startProxmoxVm,
  uploadSeedIso,
  waitUntilVmStopped,
} from '../../libs/proxmox/vm.js'
import { clientFrom } from './shared.js'

/**
 * @import {
 *   ResolveEndpointOptions,
 *   SyncEndpoint,
 *   VmCheckFacts,
 *   VmContext,
 *   VmDestroyOptions,
 *   VmDiskSpec,
 *   VmPowerState,
 *   VmSpecs,
 * } from '../../driver-contract.js'
 */
/** @import { SerialFollow } from '../../libs/console.js' */
/** @import { ProxmoxClient } from '../../libs/proxmox/client.js' */

/**
 * @typedef {object} ProxmoxHandle
 * @property {ProxmoxClient} client
 * @property {number} vmid
 * @property {string} name
 * @property {string | null} [isoVolid]
 */

/**
 * @param {string} label
 * @param {VmDiskSpec} d
 */
function attachSpecFromDisk(label, d) {
  if (d.type === 'physical') {
    return {
      id: label,
      mode: /** @type {'physical'} */ ('physical'),
      kind: /** @type {'tank'} */ ('tank'),
    }
  }
  return {
    id: label,
    mode: /** @type {'virtual'} */ ('virtual'),
    kind: /** @type {'tank'} */ ('tank'),
    size: d.size,
  }
}

export const provisionOverlaySchema = proxmoxSchema

/**
 * @param {VmContext} ctx
 * @returns {Promise<ProxmoxHandle | null>}
 */
export async function find(ctx) {
  const name = String(ctx.name).trim()
  const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
  const vmid = await client.findVmidByName(name)
  if (vmid == null) return null
  return { client, vmid, name, isoVolid: null }
}

/**
 * @param {VmContext} ctx
 * @returns {Promise<VmPowerState>}
 */
export async function powerState(ctx) {
  if (ctx.dryRun) return { kind: 'absent', detail: 'dry-run' }
  const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
  const vmid = await client.findVmidByName(String(ctx.name).trim())
  if (vmid == null) return { kind: 'absent' }
  const st = await client.qemuStatus(vmid)
  const raw = String(st?.status || '').trim() || '?'
  if (raw === 'running') return { kind: 'running', detail: raw }
  return { kind: 'stopped', detail: raw }
}

/**
 * @param {VmContext} ctx
 * @param {ResolveEndpointOptions} [opts]
 * @returns {Promise<SyncEndpoint>}
 */
export async function resolveEndpoint(ctx, opts = {}) {
  const username = (opts.user || 'rocky').trim() || 'rocky'
  const remoteDir = (opts.remoteDir || '/tank/rocky').trim() || '/tank/rocky'
  const identity = opts.identity?.trim() || undefined

  if (!opts.host?.trim()) {
    throw new Error(
      'proxmox sync needs --host <guest-ip> (and optional --port).\n' + '  Tip: qctl vm ssh-info',
    )
  }
  const host = opts.host.trim()
  const port = opts.port != null ? Number(opts.port) : 22
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be 1–65535 (got ${opts.port})`)
  }
  return {
    host,
    port,
    username,
    remoteDir,
    identity,
    label: `${username}@${host}:${port} (proxmox/${ctx.env || 'dev'}) → ${remoteDir}`,
  }
}

/**
 * Patch guest from {@link VmSpecs} — only listed fields change.
 * @param {VmContext} _ctx
 * @param {ProxmoxHandle} vm
 * @param {Partial<VmSpecs>} [specs]
 * @returns {Promise<void>}
 */
export async function reconcile(_ctx, vm, specs) {
  if (!specs) return

  if (specs.disks) {
    const labels = Object.keys(specs.disks)
    const wantDisposable = INIT_TANK_BOOT_ID in specs.disks
    if (wantDisposable) {
      if (specs.memory == null || specs.vcpus == null) {
        die('proxmox reconcile: memory and vcpus required when attaching disks')
      }
      const bootLabel = specs.bootDrive || labels[0]
      const boot = specs.disks[bootLabel]
      if (boot?.type !== 'virtual' || !boot.image?.trim()) {
        die('proxmox reconcile: boot disk must be virtual with image (import volid)')
      }
      const importVolid = boot.image.trim()
      const isoPath = specs.seedIsoPath?.trim()
      if (!isoPath || !fs.existsSync(isoPath)) {
        die(`proxmox reconcile: seedIsoPath missing (${isoPath || 'none'})`)
      }
      const isoVolid = await uploadSeedIso(vm.client, isoPath, {
        filename: `rocky-${vm.name}-init-tank.iso`,
      })
      vm.isoVolid = isoVolid
      const diskSpecs = Object.entries(specs.disks)
        .filter(([label]) => label !== bootLabel)
        .map(([label, d]) => attachSpecFromDisk(label, d))
      await attachInitTankBootOnAppliance(vm.client, {
        vmid: vm.vmid,
        name: vm.name,
        memory: specs.memory,
        vcpus: specs.vcpus,
        importVolid,
        isoVolid,
        osSize: boot.size,
        forceTankIds: [],
        diskSpecs,
      })
      return
    }

    await removeInitTankBootDisks(vm.client, vm.vmid)
    await vm.client.put(
      `/nodes/${encodeURIComponent(vm.client.config.node)}/qemu/${vm.vmid}/config`,
      { boot: 'order=scsi0' },
    )
    console.log(chalk.dim(`vm: appliance ${vm.name} disposable boot detached`))

    if (specs.memory != null && specs.vcpus != null) {
      const diskSpecs = Object.entries(specs.disks).map(([label, d]) =>
        attachSpecFromDisk(label, d),
      )
      await reconcileRockyAppliance(vm.client, {
        vmid: vm.vmid,
        name: vm.name,
        memory: specs.memory,
        vcpus: specs.vcpus,
        disks: diskSpecs,
      })
    }
    return
  }

  if (specs.memory != null && specs.vcpus != null) {
    const st = await vm.client.qemuStatus(vm.vmid)
    if (st?.status === 'running' || st?.status === 'paused') {
      const upid = await vm.client.post(
        `/nodes/${encodeURIComponent(vm.client.config.node)}/qemu/${vm.vmid}/status/stop`,
        {},
      )
      if (upid) await vm.client.waitTask(String(upid), { timeoutSec: 120 })
    }
    await vm.client.put(
      `/nodes/${encodeURIComponent(vm.client.config.node)}/qemu/${vm.vmid}/config`,
      {
        memory: String(specs.memory),
        cores: String(specs.vcpus),
      },
    )
    console.log(chalk.dim(`vm: ${vm.name} memory=${specs.memory}MiB vcpus=${specs.vcpus}`))
  }
}

/**
 * Define VM only (stopped). Uploads seed ISO + ensures cloud image import.
 * @param {VmContext} ctx
 * @param {VmSpecs} specs
 * @param {AbortSignal} _signal
 * @returns {Promise<ProxmoxHandle>}
 */
export async function create(ctx, specs, _signal) {
  const name = String(ctx.name).trim()
  const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
  if ((await client.findVmidByName(name)) != null) {
    die(`proxmox create: VM ${name} already exists`)
  }
  const isoPath = specs.seedIsoPath
  if (!isoPath || !fs.existsSync(isoPath)) {
    die(`proxmox create: seed ISO missing at ${isoPath || '(none)'}`)
  }
  const diskLabels = Object.keys(specs.disks || {})
  if (!diskLabels.length) die('proxmox create: disks plan is empty')
  const bootLabel = specs.bootDrive || diskLabels[0]
  const boot = specs.disks[bootLabel]
  if (boot?.type !== 'virtual' || !boot.image?.trim()) {
    die('proxmox create: boot disk must be virtual with image (import volid)')
  }
  const importVolid = boot.image.trim()
  const isoVolid = await uploadSeedIso(client, isoPath, {
    filename: `rocky-${name}-appliance.iso`,
  })
  const osSize = boot.size
  const diskSpecs = Object.entries(specs.disks)
    .filter(([label]) => label !== bootLabel)
    .map(([label, d]) => attachSpecFromDisk(label, d))
  const expectedIds = diskSpecs.map((d) => d.id)
  const held = await loadDisksFromHolder(client, name)
  const hname = holderVmName(name)
  const holderVmid = await client.findVmidByName(hname)

  if (specs.memory == null || specs.vcpus == null) {
    die('proxmox create: memory and vcpus are required')
  }

  if (holderVmid != null && held && expectedIds.every((id) => held.volids?.[id])) {
    console.log(chalk.cyan(`vm: promote holder ${hname} → ${name}`))
    const { vmid } = await promoteHolderToAppliance(client, {
      name,
      memory: specs.memory,
      vcpus: specs.vcpus,
      importVolid,
      isoVolid,
      osSize,
      expectedIds,
    })
    // promote currently starts the VM — stop so runner owns start()+serial.
    const st = await client.qemuStatus(vmid)
    if (st?.status === 'running' || st?.status === 'paused') {
      const upid = await client.post(
        `/nodes/${encodeURIComponent(client.config.node)}/qemu/${vmid}/status/stop`,
        {},
      )
      if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
    }
    return { client, vmid, name, isoVolid }
  }

  const { vmid } = await createRockyVm(client, {
    name,
    memory: specs.memory,
    vcpus: specs.vcpus,
    importVolid,
    isoVolid,
    osSize,
    disks: disksWithReuseVolids(diskSpecs, held),
  })
  return { client, vmid, name, isoVolid }
}

/**
 * @param {VmContext} _ctx
 * @param {ProxmoxHandle} vm
 * @param {{
 *   serial?: boolean,
 *   classify?: (line: string) => { status: 'ok' | 'fail', line: string } | null,
 * }} [opts]
 * @returns {Promise<SerialFollow | null>}
 */
export async function start(_ctx, vm, opts = {}) {
  const serialOpts = opts.classify ? { classify: opts.classify } : {}
  const st = await vm.client.qemuStatus(vm.vmid)
  if (st?.status === 'running') {
    console.log(chalk.dim(`vm: Proxmox VM ${vm.name} already running`))
    if (!opts.serial) {
      await restoreProxmoxDisplay(vm.client, vm.vmid, { reboot: false })
      return null
    }
    return startProxmoxSerialFollow(vm.client, vm.vmid, vm.name, serialOpts)
  }
  await startProxmoxVm(vm.client, vm.vmid, vm.name)
  if (!opts.serial) {
    await restoreProxmoxDisplay(vm.client, vm.vmid, { reboot: false })
    return null
  }
  return startProxmoxSerialFollow(vm.client, vm.vmid, vm.name, serialOpts)
}

/**
 * @param {VmContext} _ctx
 * @param {ProxmoxHandle} vm
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function stop(_ctx, vm, opts = {}) {
  const st = await vm.client.qemuStatus(vm.vmid)
  if (st?.status === 'stopped') return
  const action = opts.force ? 'stop' : 'shutdown'
  const upid = await vm.client.post(
    `/nodes/${encodeURIComponent(vm.client.config.node)}/qemu/${vm.vmid}/status/${action}`,
    {},
  )
  if (upid) await vm.client.waitTask(String(upid), { timeoutSec: 120 })
  if (opts.force) await waitUntilVmStopped(vm.client, vm.vmid, { timeoutSec: 120 })
}

/**
 * Delete/demote guest; keepDisks non-empty → demote/keep holder disks.
 * @param {VmContext} ctx
 * @param {VmDestroyOptions} [opts]
 * @returns {Promise<void>}
 */
export async function destroy(ctx, opts = {}) {
  const keep = opts.keepDisks ?? []
  const vm = await find(ctx)
  if (vm) {
    await destroyRockyVm(vm.client, {
      vmid: vm.vmid,
      name: vm.name,
      keep: keep.length ? 'persistent' : 'none',
      tankIds: keep,
    })
    return
  }
  if (keep.length) return
  const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
  await destroyHolder(client, String(ctx.name).trim())
}

/**
 * @param {VmContext} _ctx
 * @param {ProxmoxHandle} vm
 * @returns {Promise<void>}
 */
export async function detachSeed(_ctx, vm) {
  await detachAndDeleteSeedIso(vm.client, vm.vmid, vm.isoVolid ?? null)
}

/**
 * @param {VmContext} ctx
 * @returns {Promise<VmCheckFacts>}
 */
export async function collectCheckFacts(ctx) {
  /** @type {VmCheckFacts['items']} */
  const items = []
  try {
    const client = await clientFrom({ env: ctx.env, profile: ctx.profile })
    const ver = await client.version()
    items.push({
      id: 'proxmox-api',
      ok: true,
      detail: `version=${ver?.version || '?'} node=${client.config.node}`,
    })
    const name = String(ctx.name).trim()
    const vmid = await client.findVmidByName(name)
    items.push({
      id: 'vm',
      ok: vmid != null,
      detail: vmid != null ? `${name} vmid=${vmid}` : `${name} absent`,
    })
  } catch (err) {
    items.push({
      id: 'proxmox-api',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    })
  }
  return { items }
}
