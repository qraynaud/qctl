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
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { runSeed } from '../../libs/seed/run.js'
import { isAbortError } from '../../libs/wait.js'
import { ping } from './shared.js'

/** @import { SerialFollow } from '../../libs/console.js' */
/** @import { QemuConfig } from '../../libs/proxmox/types.js' */
/** @import { VmArgv } from '../../types.js' */

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

  if (dryRun) {
    const pin = await ensureCloudImage({ env: env || 'dev', target: 'proxmox' })
    console.log(chalk.green('vm: dry-run Proxmox init-tank steps:'))
    console.log(`  1. seed --profile init-tank (pools=${selection.poolIds.join(',')})`)
    console.log(
      `  2. ensure cloud image on PVE (${pin.file}: LAN upload from cache, else download-url)`,
    )
    console.log(
      `  3. upload NoCloud ISO; prepare disks`
        + (force
          ? ` (recreate tank members ${selection.memberIds.join(',')})`
          : ' (tank members must be absent on holder unless -f)'),
    )
    console.log('  4. create/start VM from resolved disk topology')
    console.log(
      `  5. wait for guest poweroff (≤${timeoutSec}s)${noConsole ? '' : '; stream serial'}`,
    )
    console.log(
      `  6. demote → holder ${holderVmName(name)} (rename; disks stay attached); delete seed ISO`,
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
    profile: 'init-tank',
    allowMissingTier0: false,
    allowMissingFiles: false,
    env,
    target: argv.target || 'proxmox',
    initTankPools: selection.poolIds,
    initTankForce: force,
  })
  const isoPath = seedResult.isoPath
  if (!fs.existsSync(isoPath)) {
    die(`init-tank ISO missing at ${isoPath} — run \`qctl vm seed --profile init-tank\``)
  }

  const importVolid = await ensureCloudImageImport(client, {
    force: Boolean(forceDownload),
  })
  const isoVolid = await uploadSeedIso(client, isoPath, {
    filename: `rocky-${name}-init-tank.iso`,
  })

  const existing = await client.findVmidByName(name)
  if (existing != null) {
    console.log(chalk.yellow(`vm: demoting existing ${name} before init-tank`))
    await destroyRockyVm(client, {
      vmid: existing,
      name,
      keep: force ? 'vw' : 'persistent',
      tankIds: force ? tankIds : [],
    })
  }

  const held = await loadDisksFromHolder(client, name)
  /** @type {number} */
  let vmid

  const heldTankHits = tankIds.filter((id) => held?.volids?.[id])
  if (heldTankHits.length && !force) {
    die(
      `init-tank: tank member(s) already on holder: ${heldTankHits.join(', ')}\n`
        + `  pass -f to recreate the pool on those members only (data volumes stay)`,
    )
  }

  const dataPresent = dataIds.length > 0 && dataIds.every((id) => held?.volids?.[id])
  if (held && dataPresent) {
    const hvmid = await client.findVmidByName(holderVmName(name))
    if (hvmid == null) die(`holder ${holderVmName(name)} not found`)
    console.log(chalk.cyan(`vm: reusing holder ${holderVmName(name)} as init-tank VM`))
    const hcfg = await client.qemuConfig(hvmid)
    /** @type {string[]} */
    const tankKeys = []
    const wipe = new Set(force ? tankIds : [])
    for (const [key, val] of Object.entries(hcfg)) {
      if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
      const serial = String(val).match(/(?:^|,)serial=([^,]+)/)?.[1]
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
      const serial = String(cfg2.scsi0).match(/(?:^|,)serial=([^,]+)/)?.[1]
      if (serial && expectedIds.includes(serial)) {
        die(`holder has ${serial} on scsi0 — expected OS slot free`)
      }
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, {
        delete: 'scsi0',
        force: '1',
      })
    }
    // Keep existing data volume serials; (re)add tank members as virtual.
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
  }

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
    await demoteToHolder(client, { vmid, name })

    console.log(chalk.green('vm: init-tank done'))
    console.log(
      chalk.dim(`  kept ${expectedIds.length} persistent disk(s) on holder ${holderVmName(name)}`),
    )
    console.log(chalk.dim('  next: qctl vm up --target proxmox'))
    console.log(chalk.dim('  (appliance first-boot 30 will import tank)'))
  } catch (err) {
    if (err instanceof Error && isGuestFatalError(err)) {
      await reportGuestFatalLeaveRunning(consoleFollow, err, {
        leaveHint: `vm: VM ${name} (vmid=${vmid}) left as-is for diagnosis (PVE console); destroy when done`,
        destroyHint: `  qctl vm destroy --target proxmox --env ${env}`,
      })
      consoleFollow = null
      return
    }
    if (isAbortError(err) || ac.signal.aborted) {
      if (consoleFollow) await consoleFollow.stop()
      console.log(chalk.yellow('vm: init-tank aborted — VM left as-is'))
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
