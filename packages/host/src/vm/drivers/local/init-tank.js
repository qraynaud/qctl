import { $, chalk } from 'zx'

import { downloadImage } from '../../commands/download.js'
import { matchInitTankFatal, startSerialTcpFollow } from '../../libs/console.js'
import { ensureDisks } from '../../libs/disks.js'
import {
  isGuestFatalError,
  reportGuestFatalLeaveRunning,
  waitForSuccessOrGuestFatal,
} from '../../libs/guest-fatal.js'
import { domainExists, ensureDefaultNetwork, removeDomain, virsh } from '../../libs/libvirt.js'
import { portsFromArgv } from '../../libs/options.js'
import { DATA_COUNT, SPECIAL_COUNT } from '../../libs/paths.js'
import { ensureSeed, runSeed } from '../../libs/seed.js'
import { HOST_DEPS, die, errMessage, requireBins } from '../../libs/util.js'
import { buildVirtInstallArgs } from '../../libs/virt-install.js'
import { isAbortError, sleep } from '../../libs/wait.js'
import { destroyVm } from './destroy.js'

/** @import { VmArgv } from '../../types.js' */

/** @typedef {Awaited<ReturnType<typeof startSerialTcpFollow>>} TcpFollow */

/**
 * Wait until domain is shut off (guest poweroff after tank-create) or gone.
 * @param {string} connect
 * @param {string} name
 * @param {number} timeoutSec
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
async function waitForDomainShutOff(connect, name, timeoutSec, signal) {
  const deadline = Date.now() + timeoutSec * 1000
  console.log(
    chalk.cyan(`vm: waiting for guest poweroff after tank-create (timeout ${timeoutSec}s)…`),
  )
  let attempt = 0
  while (Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    attempt += 1
    const r = await virsh(connect, 'domstate', name).quiet().nothrow()
    if (r.exitCode !== 0) {
      console.log(chalk.green('vm: domain gone'))
      return
    }
    const state = String(r.stdout || '').trim()
    if (state === 'shut off' || state === '') {
      console.log(chalk.green('vm: guest shut off (init-tank finished)'))
      return
    }
    if (attempt === 1 || attempt % 6 === 0) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      console.log(chalk.dim(`vm: domain state=${state} (${left}s left)`))
    }
    await sleep(5000, signal)
  }
  die(
    `domain ${name} still running after ${timeoutSec}s — init-tank prep likely failed; check serial console`,
  )
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function initTank(argv) {
  const {
    name,
    connect,
    memory,
    vcpus,
    vwSize,
    dataSize,
    specialSize,
    network,
    osinfo,
    timeout,
    dryRun,
    forceDownload,
    noConsole,
    env,
  } = argv

  const net = network === 'auto' ? 'user' : network
  const timeoutSec = timeout
  const ports = portsFromArgv(argv)

  console.log(
    chalk.dim(
      '  wipe OS + tank vdevs; keep /vw; guest: create→export→poweroff; host: destroy --keep-data',
    ),
  )

  if (dryRun) {
    console.log(chalk.green('vm: dry-run init-tank steps:'))
    console.log('  1. seed --profile init-tank')
    console.log('  2. remove existing domain; wipe OS + data/special (keep /vw)')
    console.log('  3. virt-install minimal seed (no sshd)')
    console.log(
      `  4. wait for guest poweroff (≤${timeoutSec}s)${noConsole ? '' : '; stream serial console'}`,
    )
    console.log('  5. destroy --keep-data')
    return
  }

  await requireBins(['virt-install', 'virsh', 'qemu-img'])

  // Seed first so provision !env / host vw() resolve while secrets backends may still be up.
  console.log(chalk.cyan('vm: building init-tank seed…'))
  const seedResult = await runSeed({
    profile: 'init-tank',
    allowMissingTier0: false,
    allowMissingFiles: false,
    env,
  })

  if (await domainExists(connect, name)) {
    console.log(chalk.yellow(`vm: removing existing domain ${name} before init-tank`))
    await removeDomain(connect, name)
  } else {
    console.log(chalk.dim(`vm: domain ${name} not defined (ok)`))
  }

  const baseImage = await downloadImage({
    force: forceDownload,
    env: env || 'dev',
    target: 'local',
  })
  const seed = await ensureSeed({
    isoPath: seedResult.isoPath,
    imgPath: seedResult.imgPath,
  })
  const disks = await ensureDisks({
    name,
    baseImage,
    vwSize,
    dataSize,
    specialSize,
    wipeOs: true,
    wipeTank: true,
    dryRun: false,
  })

  const ac = new AbortController()
  let cleaning = false
  /** @type {TcpFollow | null} */
  let consoleFollow = null
  let domainStarted = false

  const cleanupOnAbort = async () => {
    if (cleaning) return
    cleaning = true
    console.log(chalk.yellow('\nvm: interrupted — stopping console and destroying domain…'))
    try {
      if (consoleFollow) {
        await consoleFollow.stop()
        consoleFollow = null
      }
      if (domainStarted || (await domainExists(connect, name))) {
        // Full wipe of this attempt (OS + /vw + tank); re-run init-tank from scratch.
        await destroyVm({ connect, name, keepData: false, dryRun: false })
      }
    } catch (err) {
      console.error(chalk.red(`vm: cleanup after interrupt failed: ${errMessage(err)}`))
    }
  }

  const onSignal = () => {
    ac.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    /** @type {number | undefined} */
    let serialTcpPort
    if (!noConsole) {
      consoleFollow = await startSerialTcpFollow({
        classify: (line) => {
          const hit = matchInitTankFatal(line)
          return hit ? { status: 'fail', line: hit } : null
        },
      })
      serialTcpPort = consoleFollow.port
    }

    const args = buildVirtInstallArgs({
      connect,
      name,
      memory,
      vcpus,
      disks,
      seed,
      ports,
      argv,
      network: net,
      osinfo,
      serialTcpPort,
    })
    await ensureDefaultNetwork(connect)
    console.log(chalk.cyan('vm: virt-install …'))
    const inst = await $`${args}`.nothrow()
    if (inst.exitCode !== 0) {
      console.error(String(inst.stderr || inst.stdout))
      die(`virt-install failed (exit ${inst.exitCode})\n\n${HOST_DEPS}`)
    }
    domainStarted = true

    await waitForSuccessOrGuestFatal({
      waitUntilStopped: (signal) => waitForDomainShutOff(connect, name, timeoutSec, signal),
      signal: ac.signal,
      consoleFollow,
    })

    if (consoleFollow) {
      await consoleFollow.stop()
      consoleFollow = null
    }

    await destroyVm({ connect, name, keepData: true, dryRun: false })

    console.log(chalk.green('vm: init-tank done'))
    console.log(chalk.dim(`  kept /vw + data×${DATA_COUNT} + special×${SPECIAL_COUNT}; OS removed`))
    console.log(chalk.dim('  next: qctl vm up --wipe-os'))
    console.log(chalk.dim('  (appliance first-boot 30 will import tank)'))
  } catch (err) {
    if (err instanceof Error && isGuestFatalError(err)) {
      await reportGuestFatalLeaveRunning(consoleFollow, err, {
        leaveHint: `vm: domain ${name} left running for diagnosis (serial/journal); destroy when done:`,
        destroyHint: '  qctl vm destroy',
      })
      consoleFollow = null
      return
    }
    if (isAbortError(err) || ac.signal.aborted) {
      await cleanupOnAbort()
      process.exitCode = 130
      console.log(chalk.yellow('vm: init-tank aborted'))
      return
    }
    throw err
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (consoleFollow) await consoleFollow.stop()
  }
}
