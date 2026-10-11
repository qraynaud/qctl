import { chalk, fs } from 'zx'

import { matchInitTankFatal } from '../../libs/console.js'
import { DATA_COUNT, SPECIAL_COUNT } from '../../libs/paths.js'
import { ensureCloudImage } from '../../libs/platform-tooling.js'
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
  ensureCloudImageImport,
  sizeToGiB,
  uploadSeedIso,
  waitUntilVmStopped,
} from '../../libs/proxmox/vm.js'
import { runSeed } from '../../libs/seed.js'
import { assertProxmoxDiskPlan } from '../../libs/target.js'
import { die, errMessage } from '../../libs/util.js'
import { isAbortError } from '../../libs/wait.js'
import { ping } from './shared.js'

/** @import { SerialFollow } from '../../libs/console.js' */
/** @import { ProxmoxClient } from '../../libs/proxmox/client.js' */
/** @import { QemuConfig } from '../../libs/proxmox/types.js' */
/** @import { VmArgv } from '../../types.js' */

/** @typedef {{ ok: boolean, aborted?: boolean, line?: string }} WaitOutcome */

/**
 * @param {Error | { name?: string } | string | number | boolean | null | undefined} err
 * @returns {err is Error}
 */
function isGuestFatalError(err) {
  return err instanceof Error && err.name === 'GuestFatalError'
}

/**
 * Race poweroff wait against serial fatal patterns (cloud-init / prep failure).
 * On fatal: abort the wait; leave the VM running for diagnosis.
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} name
 * @param {number} timeoutSec
 * @param {AbortSignal} signal
 * @param {SerialFollow | null} consoleFollow
 * @returns {Promise<void>}
 */
async function waitForSuccessOrGuestFatal(client, vmid, name, timeoutSec, signal, consoleFollow) {
  if (!consoleFollow?.result) {
    await waitUntilVmStopped(client, vmid, { timeoutSec, name })
    return
  }

  const waitAc = new AbortController()
  const onParentAbort = () => waitAc.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  /** @type {Promise<WaitOutcome>} */
  const shutOff = waitUntilVmStopped(client, vmid, {
    timeoutSec,
    name,
    signal: waitAc.signal,
  }).then(
    () => ({ ok: true }),
    (err) => {
      if (isAbortError(err) && !signal?.aborted) {
        return { ok: false, aborted: true }
      }
      throw err
    },
  )

  /** @type {Promise<WaitOutcome>} */
  const fatal = consoleFollow.result.then((hit) => ({
    ok: false,
    line: hit.line,
  }))

  try {
    const result = await Promise.race([shutOff, fatal])
    if (result.ok) return

    waitAc.abort()
    await shutOff.catch(() => {})

    if (result.line) {
      const err = new Error(result.line)
      err.name = 'GuestFatalError'
      throw err
    }
  } finally {
    signal?.removeEventListener('abort', onParentAbort)
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function initTank(argv) {
  assertProxmoxDiskPlan({ target: argv.target || 'proxmox', env: argv.env })

  const {
    name,
    memory,
    vcpus,
    vwSize,
    dataSize,
    specialSize,
    timeout,
    dryRun,
    forceDownload,
    env,
    noConsole,
  } = argv
  const timeoutSec = timeout || 2700

  if (dryRun) {
    const pin = await ensureCloudImage({ env: env || 'dev', target: 'proxmox' })
    console.log(chalk.green('vm: dry-run Proxmox init-tank steps:'))
    console.log('  1. seed --profile init-tank')
    console.log(
      `  2. ensure cloud image on PVE (${pin.file}: LAN upload from cache, else download-url)`,
    )
    console.log('  3. upload NoCloud ISO; prepare disks (reuse /vw from holder if any)')
    console.log(`  4. create/start VM (OS + /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT})`)
    console.log(
      `  5. wait for guest poweroff (≤${timeoutSec}s)${noConsole ? '' : '; stream serial'}`,
    )
    console.log(
      `  6. demote → holder ${holderVmName(name)} (rename; disks stay attached); delete seed ISO`,
    )
    return
  }

  const client = await ping(argv)
  const node = client.config.node

  console.log(chalk.cyan('vm: building init-tank seed…'))
  const seedResult = await runSeed({
    profile: 'init-tank',
    allowMissingTier0: false,
    allowMissingFiles: false,
    env,
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
    await destroyRockyVm(client, { vmid: existing, name, keep: 'vw' })
  }

  const held = await loadDisksFromHolder(client, name)
  /** @type {number} */
  let vmid

  if (held?.vw) {
    const hvmid = await client.findVmidByName(holderVmName(name))
    if (hvmid == null) die(`holder ${holderVmName(name)} not found`)
    console.log(chalk.cyan(`vm: reusing holder ${holderVmName(name)} as init-tank VM`))
    const hcfg = await client.qemuConfig(hvmid)
    /** @type {string[]} */
    const tankKeys = []
    for (const [key, val] of Object.entries(hcfg)) {
      if (!/^(scsi|virtio|sata)\d+$/.test(key)) continue
      const serial = String(val).match(/(?:^|,)serial=([^,]+)/)?.[1]
      if (serial && /^rocky-(data|special)/.test(serial)) tankKeys.push(key)
    }
    if (tankKeys.length) {
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, {
        delete: tankKeys.join(','),
        force: '1',
      })
    }
    const storage = client.config.storage
    const dataGiB = sizeToGiB(dataSize)
    const specialGiB = sizeToGiB(specialSize)
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
      scsi0: `${storage}:0,import-from=${importVolid},size=20G`,
      ide2: `${isoVolid},media=cdrom`,
    }
    applyNetsToForm(form, client.config.nets)
    const cfg2 = await client.qemuConfig(hvmid)
    if (cfg2.scsi0) {
      const serial = String(cfg2.scsi0).match(/(?:^|,)serial=([^,]+)/)?.[1]
      if (serial?.startsWith('rocky-')) {
        die(`holder has ${serial} on scsi0 — expected /vw on scsi1+`)
      }
      await client.put(`/nodes/${encodeURIComponent(node)}/qemu/${hvmid}/config`, {
        delete: 'scsi0',
        force: '1',
      })
    }
    let scsi = 2
    for (let i = 0; i < DATA_COUNT; i++) {
      form[`scsi${scsi++}`] = `${storage}:${dataGiB},serial=rocky-data${i}`
    }
    for (let i = 0; i < SPECIAL_COUNT; i++) {
      form[`scsi${scsi++}`] = `${storage}:${specialGiB},serial=rocky-special${i}`
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
    // Holder without rocky-vw, or name clash → refuse (createAndStart also checks).
    await assertNameFreeForCreate(client, name)
    console.log(chalk.dim(`vm: no holder ${holderVmName(name)} — fresh disks`))
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

    await waitForSuccessOrGuestFatal(client, vmid, name, timeoutSec, ac.signal, consoleFollow)

    if (consoleFollow) {
      await consoleFollow.stop()
      consoleFollow = null
    }

    await detachAndDeleteSeedIso(client, vmid, isoVolid)
    await demoteToHolder(client, { vmid, name })

    console.log(chalk.green('vm: init-tank done'))
    console.log(
      chalk.dim(
        `  kept /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT} on holder ${holderVmName(name)}`,
      ),
    )
    console.log(chalk.dim('  next: qctl vm up --target proxmox'))
    console.log(chalk.dim('  (appliance first-boot 30 will import tank)'))
  } catch (err) {
    if (err instanceof Error && isGuestFatalError(err)) {
      if (consoleFollow) {
        await consoleFollow.stop()
        consoleFollow = null
      }
      console.error(chalk.red(`vm: guest failure detected on serial — stopping wait`))
      console.error(chalk.red(`  ${errMessage(err)}`))
      console.error(
        chalk.yellow(
          `vm: VM ${name} (vmid=${vmid}) left as-is for diagnosis (PVE console); destroy when done`,
        ),
      )
      console.error(chalk.dim(`  qctl vm destroy --target proxmox --env ${env}`))
      process.exitCode = 1
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
    console.error(chalk.dim(`  qctl vm destroy --target proxmox --env ${env}`))
    process.exitCode = 1
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (consoleFollow) await consoleFollow.stop()
  }
}
