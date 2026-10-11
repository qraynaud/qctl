import { chalk, fs } from 'zx'

import { IMAGE } from '../../commands/download.js'
import { classifyCloudInitOutcome, classifyRebootReady } from '../../libs/console.js'
import { DATA_COUNT, SPECIAL_COUNT } from '../../libs/paths.js'
import {
  assertNameFreeForCreate,
  holderVmName,
  loadDisksFromHolder,
  promoteHolderToAppliance,
} from '../../libs/proxmox/disk-holder.js'
import { startProxmoxSerialFollow } from '../../libs/proxmox/serial.js'
import {
  createAndStartRockyVm,
  destroyRockyVm,
  detachAndDeleteSeedIso,
  ensureCloudImageImport,
  reconcileRockyAppliance,
  restoreProxmoxDisplay,
  uploadSeedIso,
} from '../../libs/proxmox/vm.js'
import { runSeed } from '../../libs/seed.js'
import { assertProxmoxDiskPlan } from '../../libs/target.js'
import { die } from '../../libs/util.js'
import { isAbortError, waitForSerialOutcome } from '../../libs/wait.js'
import { clientFrom, ping } from './shared.js'

/** @import { SerialFollow } from '../../libs/console.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @returns {Promise<void>}
 */
async function printSshHint() {
  console.log(chalk.dim(`  (Proxmox: SSH via guest IP / PVE net; no local passt hostfwd)`))
}

/**
 * @param {VmArgv} argv
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
async function startExisting(argv, { signal } = {}) {
  const client = await clientFrom(argv)
  const { name, noConsole, timeout, memory, vcpus, vwSize, dataSize, specialSize } = argv
  const timeoutSec = timeout || 2700
  const vmid = await client.findVmidByName(name)
  if (vmid == null) die(`Proxmox VM ${name} not found — create with up first`)

  await reconcileRockyAppliance(client, {
    vmid,
    name,
    memory,
    vcpus,
    vwSize,
    dataSize,
    specialSize,
  })

  console.log(chalk.cyan(`vm: starting Proxmox VM ${name} (vmid=${vmid})…`))
  const upid = await client.post(
    `/nodes/${encodeURIComponent(client.config.node)}/qemu/${vmid}/status/start`,
    {},
  )
  if (upid) await client.waitTask(upid, { timeoutSec: 120 })

  if (noConsole) {
    console.log(chalk.green(`vm: Proxmox VM ${name} started`))
    await restoreProxmoxDisplay(client, vmid)
    return
  }

  /** @type {SerialFollow | null} */
  let consoleFollow = null
  try {
    consoleFollow = await startProxmoxSerialFollow(client, vmid, name, {
      classify: classifyRebootReady,
    })
    console.log(chalk.green(`vm: Proxmox VM ${name} started — streaming serial until multi-user`))
    const outcome = await waitForSerialOutcome(consoleFollow, timeoutSec, signal, {
      waiting: `vm: waiting for multi-user target (timeout ${timeoutSec}s)…`,
      timeoutLine: `multi-user target not seen within ${timeoutSec}s`,
    })
    await consoleFollow.stop()
    consoleFollow = null

    if (outcome.status === 'ok') {
      console.log(chalk.green('vm: guest multi-user OK'))
      console.log(chalk.dim(`  ${outcome.line}`))
      await restoreProxmoxDisplay(client, vmid)
      return
    }

    console.error(chalk.red('vm: guest boot failed (or timed out)'))
    console.error(chalk.red(`  ${outcome.line}`))
    console.error(chalk.yellow(`vm: VM ${name} left running for diagnosis (serial display kept)`))
    process.exitCode = 1
  } finally {
    if (consoleFollow) await consoleFollow.stop()
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function up(argv) {
  assertProxmoxDiskPlan({ target: argv.target || 'proxmox', env: argv.env })

  const {
    name,
    memory,
    vcpus,
    vwSize,
    dataSize,
    specialSize,
    wipeOs,
    dryRun,
    forceDownload,
    env,
    cidata,
    timeout,
    noConsole,
  } = argv
  const timeoutSec = timeout || 2700

  if (dryRun) {
    console.log(
      chalk.green(
        `vm: dry-run Proxmox up name=${name} env=${env} `
          + `(OS + /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT}`
          + `${wipeOs ? '; wipe-os' : ''})`,
      ),
    )
    console.log(chalk.dim('  would: appliance seed ISO, ensure image'))
    console.log(
      chalk.dim(
        `  if VM exists → reconcile+start; else if holder with rocky-vw → promote; `
          + `else create only when name and ${holderVmName(name)} are both free`,
      ),
    )
    console.log(
      chalk.dim(
        noConsole
          ? '  (no console wait)'
          : `  then stream serial ≤${timeoutSec}s for cloud-init Final Stage; detach+delete seed ISO; restore virtio display`,
      ),
    )
    return
  }

  const client = await ping(argv)
  let vmid = await client.findVmidByName(name)

  const ac = new AbortController()
  const onSignal = () => ac.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    if (vmid != null && !wipeOs) {
      await startExisting(argv, { signal: ac.signal })
      await printSshHint()
      return
    }

    // Seed first (while prod/VW may still be up) so !env / vw() resolve before demote.
    console.log(chalk.cyan('vm: building appliance seed…'))
    const seedResult = await runSeed({
      profile: 'appliance',
      out: cidata || undefined,
      allowMissingTier0: false,
      allowMissingFiles: false,
      env,
    })
    const isoPath = seedResult.isoPath
    if (!fs.existsSync(isoPath)) {
      die(`appliance ISO missing at ${isoPath} — run \`qctl vm seed\``)
    }

    if (vmid != null && wipeOs) {
      console.log(
        chalk.yellow(`vm: --wipe-os — demote ${name} to holder, then promote with fresh OS`),
      )
      await destroyRockyVm(client, { vmid, name, keep: 'persistent' })
      vmid = null
    }

    const importVolid = await ensureCloudImageImport(client, {
      force: Boolean(forceDownload),
    })
    const isoVolid = await uploadSeedIso(client, isoPath, {
      filename: `rocky-${name}-appliance.iso`,
    })

    const held = await loadDisksFromHolder(client, name)
    if (held?.vw) {
      // Promote renames holder → name; name must be free (demote already did that).
      const clash = await client.findVmidByName(name)
      if (clash != null) {
        die(`cannot promote ${holderVmName(name)}: VM ${name} already exists (vmid=${clash})`)
      }
      console.log(chalk.cyan(`vm: promoting holder ${holderVmName(name)} → ${name}`))
      ;({ vmid } = await promoteHolderToAppliance(client, {
        name,
        memory,
        vcpus,
        importVolid,
        isoVolid,
      }))
    } else {
      // Holder present without rocky-vw, or appliance name taken → do not create.
      await assertNameFreeForCreate(client, name)
      console.log(
        chalk.cyan(
          `vm: no holder ${holderVmName(name)} — creating fresh VM `
            + `(tank not initialized; run init-tank or create by hand)`,
        ),
      )
      ;({ vmid } = await createAndStartRockyVm(client, {
        name,
        memory,
        vcpus,
        vwSize,
        dataSize,
        specialSize,
        importVolid,
        isoVolid,
      }))
    }

    if (noConsole) {
      await restoreProxmoxDisplay(client, vmid)
      await printSshHint()
      console.log(chalk.dim(`  image: ${IMAGE.file}`))
      console.log(
        chalk.yellow(
          `  seed ISO left at ${isoVolid} (--no-console); delete after first boot or re-run without --no-console`,
        ),
      )
      return
    }

    /** @type {SerialFollow | null} */
    let consoleFollow = null
    try {
      consoleFollow = await startProxmoxSerialFollow(client, vmid, name, {
        classify: classifyCloudInitOutcome,
      })
      const outcome = await waitForSerialOutcome(consoleFollow, timeoutSec, ac.signal, {
        waiting: `vm: waiting for cloud-init Final Stage (timeout ${timeoutSec}s)…`,
        timeoutLine: `cloud-init Final Stage not seen within ${timeoutSec}s`,
      })
      await consoleFollow.stop()
      consoleFollow = null

      if (outcome.status === 'ok') {
        console.log(chalk.green('vm: cloud-init Final Stage OK'))
        console.log(chalk.dim(`  ${outcome.line}`))
        await detachAndDeleteSeedIso(client, vmid, isoVolid)
        await restoreProxmoxDisplay(client, vmid)
        await printSshHint()
        console.log(chalk.dim(`  image: ${IMAGE.file}`))
        return
      }

      console.error(chalk.red('vm: cloud-init Final Stage failed (or timed out)'))
      console.error(chalk.red(`  ${outcome.line}`))
      console.error(
        chalk.yellow(`vm: VM ${name} left running for diagnosis (seed ISO + serial display kept)`),
      )
      process.exitCode = 1
    } finally {
      if (consoleFollow) await consoleFollow.stop()
    }
  } catch (err) {
    if (isAbortError(err) || ac.signal.aborted) {
      console.log(chalk.yellow('vm: up interrupted — VM left running'))
      process.exitCode = 130
      return
    }
    throw err
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}
