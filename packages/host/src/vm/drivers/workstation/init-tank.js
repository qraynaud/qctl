import { $, chalk, fs } from 'zx'

import { portsFromArgv } from '../../../lib/options.js'
import { HOST_DEPS, die, errMessage, requireBins } from '../../../lib/util.js'
import { downloadImage } from '../../commands/download.js'
import { assertInitTankForceOrFresh, logInitTankPools } from '../../libs/assert-init-tank-force.js'
import { summarizeAttachModes, withAttachModes } from '../../libs/attach-mode.js'
import { matchInitTankFatal, startSerialTcpFollow } from '../../libs/console.js'
import { ensureDisks } from '../../libs/disks.js'
import {
  isGuestFatalError,
  reportGuestFatalLeaveRunning,
  waitForSuccessOrGuestFatal,
} from '../../libs/guest-fatal.js'
import { ensureInitTankBootDisk, removeInitTankBootDisk } from '../../libs/init-tank-boot.js'
import { resolveInitTankPools } from '../../libs/init-tank-pools.js'
import {
  domainExists,
  ensureDefaultNetwork,
  removeDomain,
  virsh,
} from '../../libs/libvirt/index.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { ensureSeed } from '../../libs/seed/iso.js'
import { runSeed } from '../../libs/seed/run.js'
import { buildVirtInstallArgs } from '../../libs/virt-install.js'
import { isAbortError, sleep } from '../../libs/wait.js'

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
 * Undefine domain and drop disposable init-tank boot qcow only (never disks.os).
 * @param {string} connect
 * @param {string} name
 */
async function teardownInitTankDomain(connect, name) {
  if (await domainExists(connect, name)) {
    await removeDomain(connect, name)
  }
  await removeInitTankBootDisk(name)
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
  const force = Boolean(argv.force)

  const resolved = await resolveProvisionDisks({
    env: env || 'dev',
    target: argv.target || 'workstation',
    profile: argv.profile,
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
  console.log(chalk.dim(`  disks: ${summarizeAttachModes(withAttachModes(resolved.members))}`))

  if (dryRun) {
    console.log(chalk.green('vm: dry-run init-tank steps:'))
    console.log(`  1. seed --seed-profile init-tank (pools=${selection.poolIds.join(',')})`)
    console.log(
      `  2. remove domain; create disposable boot overlay (leave disks.os)`
        + (force
          ? `; wipe tank members ${selection.memberIds.join(',')}`
          : ' (tank members must be absent unless -f)'),
    )
    console.log('  3. virt-install boot=init-tank-boot + persistent disks')
    console.log(
      `  4. wait for guest poweroff (≤${timeoutSec}s)${noConsole ? '' : '; stream serial console'}`,
    )
    console.log('  5. undefine domain; delete disposable boot only')
    return
  }

  assertInitTankForceOrFresh({
    name,
    members: selection.members,
    force,
  })

  await requireBins(['virt-install', 'virsh', 'qemu-img', 'swtpm'])

  // Seed first so provision !env / host vw() resolve while secrets backends may still be up.
  console.log(chalk.cyan('vm: building init-tank seed…'))
  const seedResult = await runSeed({
    seedProfile: 'init-tank',
    profile: argv.profile,
    allowMissingTier0: false,
    allowMissingFiles: false,
    env,
    target: argv.target || 'workstation',
    initTankPools: selection.poolIds,
    initTankForce: force,
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
    target: 'workstation',
  })
  const seed = await ensureSeed({
    isoPath: seedResult.isoPath,
    imgPath: seedResult.imgPath,
  })
  // Never wipe disks.os — only ensure persistent data/tank members.
  const disks = await ensureDisks({
    name,
    baseImage,
    resolved,
    wipeOs: false,
    wipeTankIds: force ? selection.memberIds : [],
    dryRun: false,
  })
  const bootDiskPath = await ensureInitTankBootDisk({
    name,
    baseImage,
    size: resolved.os.size,
  })

  const ac = new AbortController()
  let cleaning = false
  /** @type {TcpFollow | null} */
  let consoleFollow = null
  let domainStarted = false

  const cleanupOnAbort = async () => {
    if (cleaning) return
    cleaning = true
    console.log(chalk.yellow('\nvm: interrupted — stopping console and dropping init-tank boot…'))
    try {
      if (consoleFollow) {
        await consoleFollow.stop()
        consoleFollow = null
      }
      if (domainStarted || (await domainExists(connect, name))) {
        await teardownInitTankDomain(connect, name)
      } else {
        await removeInitTankBootDisk(name)
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
      network: net,
      osinfo,
      serialTcpPort,
      bootDiskPath,
    })
    await ensureDefaultNetwork(connect)
    console.log(chalk.cyan('vm: virt-install (init-tank boot disk)…'))
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

    await teardownInitTankDomain(connect, name)

    const hasOs = fs.existsSync(disks.os.path)
    console.log(chalk.green('vm: init-tank done'))
    console.log(
      chalk.dim(
        `  kept ${disks.attached.length} persistent disk(s)`
          + (hasOs ? `; left disks.os ${disks.os.path}` : '; no disks.os yet'),
      ),
    )
    console.log(chalk.dim(hasOs ? '  next: qctl vm up' : '  next: qctl vm up --wipe-os'))
    console.log(chalk.dim('  (appliance first-boot will import tank)'))
  } catch (err) {
    if (err instanceof Error && isGuestFatalError(err)) {
      await reportGuestFatalLeaveRunning(consoleFollow, err, {
        leaveHint: `vm: domain ${name} left running for diagnosis (serial/journal); destroy when done:`,
        destroyHint: '  qctl vm destroy --keep-persistent',
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
