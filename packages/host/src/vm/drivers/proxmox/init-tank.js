import { chalk, fs } from 'zx'

import { die, errMessage } from '../../../lib/util.js'
import { ensureCloudImage } from '../../../tooling/platform-tooling.js'
import { logInitTankPools } from '../../libs/assert-init-tank-force.js'
import {
  attachSpecsFromMembers,
  diskIdsByKind,
  persistentDiskIds,
  summarizeAttachModes,
  withAttachModes,
} from '../../libs/attach-mode.js'
import { matchInitTankFatal } from '../../libs/console.js'
import {
  isGuestFatalError,
  reportGuestFatalLeaveRunning,
  waitForSuccessOrGuestFatal,
} from '../../libs/guest-fatal.js'
import { INIT_TANK_BOOT_ID } from '../../libs/init-tank-boot.js'
import { resolveInitTankPools } from '../../libs/init-tank-pools.js'
import { applyNetsToForm } from '../../libs/proxmox/config.js'
import {
  assertNameFreeForCreate,
  demoteToHolder,
  holderVmName,
  loadDisksFromHolder,
} from '../../libs/proxmox/disk-holder.js'
import { startProxmoxSerialFollow } from '../../libs/proxmox/serial.js'
import {
  createAndStartRockyVm,
  destroyRockyVm,
  detachAndDeleteSeedIso,
  disksWithReuseVolids,
  ensureCloudImageImport,
  sizeToGiB,
  uploadSeedIso,
  waitUntilVmStopped,
} from '../../libs/proxmox/vm.js'
import { diskSerialFromValue } from '../../libs/proxmox/vm-parse.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { runSeed } from '../../libs/seed/run.js'
import { isAbortError } from '../../libs/wait.js'
import { ping } from './shared.js'

/** @import { SerialFollow } from '../../libs/console.js' */
/** @import { ProxmoxClient } from '../../libs/proxmox/client.js' */
/** @import { AttachDiskSpec, QemuConfig } from '../../libs/proxmox/types.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @param {QemuConfig} cfg
 * @returns {number}
 */
function nextScsiSlot(cfg) {
  let scsi = 0
  for (const key of Object.keys(cfg)) {
    const m = /^scsi(\d+)$/.exec(key)
    if (m) scsi = Math.max(scsi, Number(m[1]) + 1)
  }
  return scsi
}

/**
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} reason
 */
async function stopVmIfRunning(client, vmid, reason) {
  const node = client.config.node
  const st = await client.qemuStatus(vmid)
  if (st?.status === 'running' || st?.status === 'paused') {
    console.log(chalk.cyan(`vm: stopping vmid=${vmid} to ${reason}…`))
    const upid = await client.post(
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
      {},
    )
    if (upid) await client.waitTask(String(upid), { timeoutSec: 120 })
  }
}

/**
 * Drop any leftover init-tank disposable boot disks (no serial, or serial=init-tank-boot).
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} [preferKey] scsi key we know we added
 */
async function removeInitTankBootDisks(client, vmid, preferKey) {
  const node = client.config.node
  const cfg = await client.qemuConfig(vmid)
  /** @type {string[]} */
  const drop = []
  if (preferKey && cfg[preferKey]) drop.push(preferKey)
  for (const [key, val] of Object.entries(cfg)) {
    if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
    if (preferKey && key === preferKey) continue
    const serial = diskSerialFromValue(val)
    if (serial === INIT_TANK_BOOT_ID) drop.push(key)
  }
  if (!drop.length) return
  console.log(chalk.yellow(`vm: remove init-tank boot ${drop.join(',')}`))
  await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
    delete: [...new Set(drop)].join(','),
    force: '1',
  })
}

/**
 * Existing appliance: attach disposable boot disk first, leave disks.os (scsi0) alone.
 * @param {ProxmoxClient} client
 * @param {{
 *   vmid: number,
 *   name: string,
 *   memory: number|string,
 *   vcpus: number|string,
 *   importVolid: string,
 *   isoVolid: string,
 *   osSize: string,
 *   force: boolean,
 *   tankIds: string[],
 *   diskSpecs: AttachDiskSpec[],
 * }} opts
 * @returns {Promise<{ vmid: number, bootKey: string }>}
 */
async function runOnExistingAppliance(client, opts) {
  const { vmid, name, memory, vcpus, importVolid, isoVolid, osSize, force, tankIds, diskSpecs } =
    opts
  const node = client.config.node
  const storage = client.config.storage

  await stopVmIfRunning(client, vmid, 'attach init-tank boot disk')
  let cfg = await client.qemuConfig(vmid)

  if (force && tankIds.length) {
    /** @type {string[]} */
    const tankKeys = []
    const wipe = new Set(tankIds)
    for (const [key, val] of Object.entries(cfg)) {
      if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
      const serial = diskSerialFromValue(val)
      if (serial && wipe.has(serial)) tankKeys.push(key)
    }
    if (tankKeys.length) {
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
        delete: tankKeys.join(','),
        force: '1',
      })
      cfg = await client.qemuConfig(vmid)
    }
  }

  // Drop a previous aborted init-tank boot if present.
  await removeInitTankBootDisks(client, vmid)
  cfg = await client.qemuConfig(vmid)

  const bootSlot = nextScsiSlot(cfg)
  const bootKey = `scsi${bootSlot}`
  console.log(
    chalk.cyan(
      `vm: appliance ${name}: disposable boot ${bootKey} (keep scsi0); boot order=${bootKey}`,
    ),
  )

  /** @type {QemuConfig} */
  const form = {
    name,
    memory: String(memory),
    cores: String(vcpus),
    cpu: 'host',
    ostype: 'l26',
    machine: 'q35',
    scsihw: 'virtio-scsi-single',
    agent: '1',
    serial0: 'socket',
    vga: 'serial0',
    boot: `order=${bootKey}`,
    [bootKey]: `${storage}:0,import-from=${importVolid},size=${osSize}`,
    ide2: `${isoVolid},media=cdrom`,
  }
  applyNetsToForm(form, client.config.nets)

  let scsi = nextScsiSlot({ ...cfg, [bootKey]: '1' })
  const recreate = new Set(force ? tankIds : [])
  for (const d of diskSpecs) {
    if (d.kind !== 'tank' || !recreate.has(d.id)) continue
    if (!d.size) die(`init-tank: tank member ${d.id} needs size to recreate`)
    // Skip if still present after non-force path
    const still = Object.values(cfg).some((v) => diskSerialFromValue(v) === d.id)
    if (still) continue
    form[`scsi${scsi++}`] = `${storage}:${sizeToGiB(d.size)},serial=${d.id}`
  }

  await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, form)
  console.log(chalk.cyan(`vm: starting ${name}…`))
  const startUpid = await client.post(
    `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`,
    {},
  )
  if (startUpid) await client.waitTask(String(startUpid), { timeoutSec: 120 })
  return { vmid, bootKey }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function initTank(argv) {
  const { name, memory, vcpus, timeout, dryRun, forceDownload, env, noConsole } = argv
  const timeoutSec = timeout || 2700
  const force = Boolean(argv.force)

  const resolved = await resolveProvisionDisks({
    env: env || 'dev',
    target: argv.target || 'proxmox',
  })
  const selection = resolveInitTankPools(resolved, argv.poolIds)
  if (!selection) {
    console.log(chalk.yellow('vm: init-tank: no disks.tanks in provision — nothing to create'))
    return
  }
  logInitTankPools(selection.poolIds)
  console.log(
    chalk.dim(
      `  disposable boot disk (keep disks.os)`
        + `${force ? `; wipe tank members` : ''}; keep data; guest: create→export→poweroff`,
    ),
  )

  if (dryRun) {
    const pin = await ensureCloudImage({ env: env || 'dev', target: 'proxmox' })
    console.log(chalk.green('vm: dry-run Proxmox init-tank steps:'))
    console.log(`  1. seed --seed-profile init-tank (pools=${selection.poolIds.join(',')})`)
    console.log(
      `  2. ensure cloud image on PVE (${pin.file}: LAN upload from cache, else download-url)`,
    )
    console.log(
      `  3. upload NoCloud ISO; attach disposable boot disk (leave disks.os)`
        + (force
          ? ` (recreate tank members ${selection.memberIds.join(',')})`
          : ' (tank members must be absent on holder unless -f)'),
    )
    console.log('  4. boot disposable disk first; wait for guest poweroff')
    console.log(
      `  5. delete disposable boot (+ seed ISO); appliance stays or demote holder ${holderVmName(name)}`,
    )
    return
  }

  const osSize = resolved.os.size || '20G'
  const tankIds = selection.memberIds
  const dataIds = diskIdsByKind(resolved.members, 'data')
  const expectedIds = persistentDiskIds(resolved.members)
  const diskSpecs = attachSpecsFromMembers(resolved.members)
  console.log(chalk.dim(`  disks: ${summarizeAttachModes(withAttachModes(resolved.members))}`))

  const client = await ping(argv)
  const node = client.config.node

  console.log(chalk.cyan('vm: building init-tank seed…'))
  const seedResult = await runSeed({
    seedProfile: 'init-tank',
    profile: argv.profile,
    allowMissingTier0: false,
    allowMissingFiles: false,
    env,
    target: argv.target || 'proxmox',
    initTankPools: selection.poolIds,
    initTankForce: force,
  })
  const isoPath = seedResult.isoPath
  if (!fs.existsSync(isoPath)) {
    die(`init-tank ISO missing at ${isoPath} — run \`qctl vm seed --seed-profile init-tank\``)
  }

  const importVolid = await ensureCloudImageImport(client, {
    force: Boolean(forceDownload),
  })
  const isoVolid = await uploadSeedIso(client, isoPath, {
    filename: `rocky-${name}-init-tank.iso`,
  })

  /** @type {number | null} */
  let vmid = null
  /** @type {string | null} */
  let bootKey = null
  /** @type {'appliance' | 'holder' | 'fresh'} */
  let mode = 'fresh'

  const existing = await client.findVmidByName(name)
  if (existing != null) {
    const cfg = await client.qemuConfig(existing)
    const scsi0 = cfg.scsi0 && !/media=cdrom/.test(String(cfg.scsi0)) ? cfg.scsi0 : null
    const scsi0Serial = scsi0 ? diskSerialFromValue(scsi0) : null
    // Appliance OS has no rocky-* serial; persistent disks do. Preserve scsi0 when present.
    if (scsi0 && !scsi0Serial) {
      mode = 'appliance'
      ;({ vmid, bootKey } = await runOnExistingAppliance(client, {
        vmid: existing,
        name,
        memory,
        vcpus,
        importVolid,
        isoVolid,
        osSize,
        force,
        tankIds,
        diskSpecs,
      }))
    } else {
      // Unexpected layout — demote then use holder path.
      console.log(chalk.yellow(`vm: demoting existing ${name} before init-tank`))
      await destroyRockyVm(client, {
        vmid: existing,
        name,
        keep: force ? 'vw' : 'persistent',
        tankIds: force ? tankIds : [],
      })
    }
  }

  if (mode !== 'appliance') {
    const held = await loadDisksFromHolder(client, name)
    const heldTankHits = tankIds.filter((id) => held?.volids?.[id])
    if (heldTankHits.length && !force) {
      die(
        `init-tank: tank member(s) already on holder: ${heldTankHits.join(', ')}\n`
          + `  pass -f to recreate the pool on those members only (data volumes stay)`,
      )
    }

    const dataPresent = dataIds.length > 0 && dataIds.every((id) => held?.volids?.[id])
    if (held && dataPresent) {
      mode = 'holder'
      const hvmid = await client.findVmidByName(holderVmName(name))
      if (hvmid == null) die(`holder ${holderVmName(name)} not found`)
      console.log(chalk.cyan(`vm: reusing holder ${holderVmName(name)} as init-tank VM`))
      const hcfg = await client.qemuConfig(hvmid)
      /** @type {string[]} */
      const tankKeys = []
      const wipe = new Set(force ? tankIds : [])
      for (const [key, val] of Object.entries(hcfg)) {
        if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
        const serial = diskSerialFromValue(val)
        if (serial && wipe.has(serial)) tankKeys.push(key)
      }
      if (tankKeys.length) {
        await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, {
          delete: tankKeys.join(','),
          force: '1',
        })
      }
      const storage = client.config.storage
      /** @type {QemuConfig} */
      const form = {
        name,
        memory: String(memory),
        cores: String(vcpus),
        cpu: 'host',
        ostype: 'l26',
        machine: 'q35',
        scsihw: 'virtio-scsi-single',
        agent: '1',
        serial0: 'socket',
        vga: 'serial0',
        boot: 'order=scsi0',
        scsi0: `${storage}:0,import-from=${importVolid},size=${osSize}`,
        ide2: `${isoVolid},media=cdrom`,
      }
      applyNetsToForm(form, client.config.nets)
      const cfg2 = await client.qemuConfig(hvmid)
      if (cfg2.scsi0) {
        const serial = diskSerialFromValue(cfg2.scsi0)
        if (serial && expectedIds.includes(serial)) {
          die(`holder has ${serial} on scsi0 — expected OS slot free`)
        }
        await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, {
          delete: 'scsi0',
          force: '1',
        })
      }
      let scsi = 1
      const afterWipe = await client.qemuConfig(hvmid)
      for (const [key] of Object.entries(afterWipe)) {
        const m = /^scsi(\d+)$/.exec(key)
        if (m) scsi = Math.max(scsi, Number(m[1]) + 1)
      }
      const recreate = new Set(tankIds)
      for (const d of diskSpecs) {
        if (d.kind !== 'tank' || !recreate.has(d.id)) continue
        if (!d.size) die(`init-tank: tank member ${d.id} needs size to recreate`)
        form[`scsi${scsi++}`] = `${storage}:${sizeToGiB(d.size)},serial=${d.id}`
      }
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, form)
      console.log(chalk.cyan(`vm: starting ${name}…`))
      const startUpid = await client.post(
        `/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/status/start`,
        {},
      )
      if (startUpid) await client.waitTask(String(startUpid), { timeoutSec: 120 })
      vmid = hvmid
      bootKey = 'scsi0'
    } else {
      await assertNameFreeForCreate(client, name)
      console.log(chalk.dim(`vm: no holder ${holderVmName(name)} — fresh disks`))
      ;({ vmid } = await createAndStartRockyVm(client, {
        name,
        memory,
        vcpus,
        importVolid,
        isoVolid,
        osSize,
        disks: disksWithReuseVolids(diskSpecs, held),
      }))
      bootKey = 'scsi0'
    }
  }

  if (vmid == null) die('init-tank: internal error — no vmid after prepare')

  const ac = new AbortController()
  const onSignal = () => ac.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  /** @type {SerialFollow | null} */
  let consoleFollow = null
  try {
    if (!noConsole) {
      consoleFollow = await startProxmoxSerialFollow(client, vmid, name, {
        classify: (line) => {
          const hit = matchInitTankFatal(line)
          return hit ? { status: 'fail', line: hit } : null
        },
      })
    }

    await waitForSuccessOrGuestFatal({
      waitUntilStopped: (signal) => waitUntilVmStopped(client, vmid, { timeoutSec, name, signal }),
      signal: ac.signal,
      consoleFollow,
    })

    if (consoleFollow) {
      await consoleFollow.stop()
      consoleFollow = null
    }

    await detachAndDeleteSeedIso(client, vmid, isoVolid)
    await removeInitTankBootDisks(client, vmid, bootKey || undefined)

    if (mode === 'appliance') {
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
        boot: 'order=scsi0',
      })
      console.log(chalk.green('vm: init-tank done'))
      console.log(chalk.dim(`  left appliance ${name} (disks.os kept); disposable boot removed`))
      console.log(chalk.dim(`  next: qctl vm up -p ${argv.profile}`))
    } else {
      await demoteToHolder(client, { vmid, name })
      console.log(chalk.green('vm: init-tank done'))
      console.log(
        chalk.dim(
          `  kept ${expectedIds.length} persistent disk(s) on holder ${holderVmName(name)}`,
        ),
      )
      console.log(chalk.dim(`  next: qctl vm up -p ${argv.profile}`))
    }
    console.log(chalk.dim('  (appliance first-boot will import tank)'))
  } catch (err) {
    if (err instanceof Error && isGuestFatalError(err)) {
      await reportGuestFatalLeaveRunning(consoleFollow, err, {
        leaveHint: `vm: VM ${name} (vmid=${vmid}) left as-is for diagnosis (PVE console); destroy when done`,
        destroyHint: `  qctl vm destroy -p ${argv.profile}`,
      })
      consoleFollow = null
      return
    }
    if (isAbortError(err) || ac.signal.aborted) {
      if (consoleFollow) await consoleFollow.stop()
      try {
        await stopVmIfRunning(client, vmid, 'abort cleanup')
        await detachAndDeleteSeedIso(client, vmid, isoVolid).catch(() => {})
        await removeInitTankBootDisks(client, vmid, bootKey || undefined)
        if (mode === 'appliance') {
          await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
            boot: 'order=scsi0',
          })
        }
      } catch (cleanupErr) {
        console.error(chalk.red(`vm: abort cleanup failed: ${errMessage(cleanupErr)}`))
      }
      console.log(chalk.yellow('vm: init-tank aborted — disposable boot removed when possible'))
      process.exitCode = 130
      return
    }
    console.error(chalk.red(`vm: ${errMessage(err)}`))
    console.error(
      chalk.yellow(
        `vm: VM ${name} (vmid=${vmid}) left as-is for diagnosis (PVE console); destroy when done`,
      ),
    )
    throw err
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (consoleFollow) await consoleFollow.stop()
  }
}
