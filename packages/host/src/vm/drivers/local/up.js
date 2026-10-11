import { $, chalk, path } from 'zx'

import { downloadImage } from '../../commands/download.js'
import {
  classifyCloudInitOutcome,
  classifyRebootReady,
  startSerialTcpFollow,
} from '../../libs/console.js'
import { ensureDisks } from '../../libs/disks.js'
import {
  domainExists,
  domainState,
  ensureDefaultNetwork,
  reconcileDomainResources,
  reconcilePasstPortForwards,
  removeDomain,
  restartWithSerialNull,
  setDomainSerialNull,
  setDomainSerialTcp,
  virsh,
} from '../../libs/libvirt.js'
import { portsFromArgv } from '../../libs/options.js'
import { getImages } from '../../libs/paths.js'
import { ensureCloudImage } from '../../libs/platform-tooling.js'
import { portByName, resolvePorts } from '../../libs/ports.js'
import { ensureSeed, runSeed } from '../../libs/seed.js'
import { printLocalSshInfo } from '../../libs/ssh-hints.js'
import { HOST_DEPS, die, requireBins, which } from '../../libs/util.js'
import { buildVirtInstallArgs } from '../../libs/virt-install.js'
import { isAbortError, sleep, waitForLocalTcpPorts, waitForSerialOutcome } from '../../libs/wait.js'

/** @import { SerialWaitOutcome } from '../../libs/console.js' */
/** @import { PortEntry, VmArgv } from '../../types.js' */

/** @typedef {Awaited<ReturnType<typeof startSerialTcpFollow>>} TcpFollow */

/**
 * Wait until domain leaves "in shutdown" (ACPI poweroff in progress).
 * @param {string} connect
 * @param {string} name
 * @param {number} [timeoutSec]
 * @returns {Promise<string | null>}
 */
async function waitUntilNotShuttingDown(connect, name, timeoutSec = 120) {
  const deadline = Date.now() + timeoutSec * 1000
  for (;;) {
    const state = await domainState(connect, name)
    if (state !== 'in shutdown') return state
    if (Date.now() >= deadline) {
      die(
        `domain ${name} still "in shutdown" after ${timeoutSec}s — try: virsh -c ${connect} destroy ${name}`,
      )
    }
    await sleep(2000)
  }
}

/**
 * Resume an already-defined domain (after `down`). Stream serial until multi-user
 * (cloud-init Final Stage only appears on first virt-install boot).
 * @param {{
 *   connect: string,
 *   name: string,
 *   ports: PortEntry[],
 *   argv: VmArgv,
 *   network: string,
 *   noConsole?: boolean,
 *   timeoutSec: number,
 *   signal: AbortSignal,
 *   memory: number,
 *   vcpus: number,
 * }} opts
 * @returns {Promise<void>}
 */
async function startExistingDomain({
  connect,
  name,
  ports,
  argv,
  network,
  noConsole,
  timeoutSec,
  signal,
  memory,
  vcpus,
}) {
  let state = await waitUntilNotShuttingDown(connect, name)

  // Like Proxmox hardware reconcile: stop → redefine → start when config drifts.
  if (network === 'user') {
    const changed = await reconcilePasstPortForwards(connect, name, ports, argv)
    if (changed) state = await waitUntilNotShuttingDown(connect, name)
  }
  {
    const changed = await reconcileDomainResources(connect, name, { memory, vcpus })
    if (changed) state = await waitUntilNotShuttingDown(connect, name)
  }

  if (state === 'running') {
    console.log(chalk.green(`vm: domain ${name} already running`))
    await printLocalSshInfo({ connect, name, ports, argv, network })
    return
  }
  if (state !== 'shut off') {
    die(
      `domain ${name} is ${state || 'missing'} — expected shut off after down; `
        + `use destroy (--keep-data) then up, or --wipe-os to recreate`,
    )
  }

  /** @type {TcpFollow | null} */
  let consoleFollow = null
  try {
    if (noConsole) {
      await setDomainSerialNull(connect, name)
      console.log(chalk.cyan(`vm: starting existing domain ${name}…`))
      const r = await virsh(connect, 'start', name).nothrow()
      if (r.exitCode !== 0) {
        die(`virsh start failed: ${String(r.stderr || r.stdout).trim()}`)
      }
      console.log(chalk.green(`vm: domain ${name} started`))
      await printLocalSshInfo({ connect, name, ports, argv, network })
      return
    }

    consoleFollow = await startSerialTcpFollow({ classify: classifyRebootReady })
    await setDomainSerialTcp(connect, name, consoleFollow.port)
    console.log(chalk.cyan(`vm: starting existing domain ${name}…`))
    const r = await virsh(connect, 'start', name).nothrow()
    if (r.exitCode !== 0) {
      die(`virsh start failed: ${String(r.stderr || r.stdout).trim()}`)
    }
    console.log(chalk.green(`vm: domain ${name} started — streaming serial until multi-user`))

    const outcome = await waitForSerialOutcome(consoleFollow, timeoutSec, signal, {
      waiting: `vm: waiting for multi-user target (timeout ${timeoutSec}s)…`,
      timeoutLine: `multi-user target not seen within ${timeoutSec}s`,
    })
    await consoleFollow.stop()
    consoleFollow = null
    // Drop dead TCP serial before leaving the guest running (avoids qemu CPU spin).
    await restartWithSerialNull(connect, name)

    if (outcome.status === 'ok') {
      console.log(chalk.green('vm: guest multi-user OK'))
      console.log(chalk.dim(`  ${outcome.line}`))
      await printLocalSshInfo({ connect, name, ports, argv, network })
      return
    }

    console.error(chalk.red('vm: guest boot failed (or timed out)'))
    console.error(chalk.red(`  ${outcome.line}`))
    console.error(chalk.yellow(`vm: domain ${name} left running for diagnosis`))
    process.exitCode = 1
  } finally {
    if (consoleFollow) await consoleFollow.stop()
  }
}

/**
 * Wait for cloud-final OK/KO on serial, or timeout.
 * @param {TcpFollow} consoleFollow
 * @param {number} timeoutSec
 * @param {AbortSignal} signal
 * @returns {Promise<SerialWaitOutcome>}
 */
async function waitForCloudInit(consoleFollow, timeoutSec, signal) {
  return waitForSerialOutcome(consoleFollow, timeoutSec, signal, {
    waiting: `vm: waiting for cloud-init Final Stage (timeout ${timeoutSec}s)…`,
    timeoutLine: `cloud-init Final Stage not seen within ${timeoutSec}s`,
  })
}

/**
 * After first-boot cloud-init: detach serial TCP (restart→pty), wait for passt
 * SSH + Cockpit, then print connection hints. Replaces ACPI reboot — destroy+start
 * already cycles the guest and applies pty serial.
 * @param {{
 *   connect: string,
 *   name: string,
 *   ports: PortEntry[],
 *   argv: VmArgv,
 *   network: string,
 *   signal: AbortSignal,
 * }} opts
 * @returns {Promise<void>}
 */
async function finishAfterConsole({ connect, name, ports, argv, network, signal }) {
  await restartWithSerialNull(connect, name)
  if (network !== 'default') {
    const resolved = resolvePorts(ports, argv)
    const sshFwd = portByName(resolved, 'ssh')?.forward
    const cockpitFwd = portByName(resolved, 'cockpit')?.forward
    const forwards = /** @type {number[]} */ ([sshFwd, cockpitFwd].filter((p) => p != null))
    await waitForLocalTcpPorts({
      ports: forwards,
      sshPorts: sshFwd != null ? [sshFwd] : [],
      signal,
      label: 'SSH + Cockpit',
      timeoutSec: 180,
    })
  }
  await printLocalSshInfo({ connect, name, ports, argv, network })
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function up(argv) {
  const {
    name,
    connect,
    memory,
    vcpus,
    vwSize,
    dataSize,
    specialSize,
    network: networkArg,
    osinfo,
    wipeOs,
    dryRun,
    forceDownload,
    cidata,
    timeout,
    noConsole,
    env,
  } = argv
  const network = networkArg === 'auto' ? 'user' : networkArg
  const timeoutSec = timeout
  const ports = portsFromArgv(argv)

  console.log(
    chalk.dim(
      `  connect=${connect}; layout: OS + /vw + data×5 (raidz2) + special×2 (mirror) + seed`,
    ),
  )

  /** @type {string} */
  let baseImage
  if (dryRun) {
    const pin = await ensureCloudImage({ env: env || 'dev', target: 'local' })
    baseImage = path.join(getImages(), pin.file)
    console.log(chalk.dim(`vm: dry-run skip download (expect ${baseImage})`))
  } else {
    baseImage = await downloadImage({
      force: forceDownload,
      env: env || 'dev',
      target: 'local',
    })
  }

  /** @type {Awaited<ReturnType<typeof ensureSeed>>} */
  let seed
  if (dryRun) {
    seed = { path: 'seed/<env>/nocloud.iso', format: 'raw', device: 'cdrom' }
  } else {
    console.log(chalk.cyan('vm: building appliance seed…'))
    const seedResult = await runSeed({
      profile: 'appliance',
      out: cidata || undefined,
      allowMissingTier0: false,
      allowMissingFiles: false,
      env: env || 'dev',
    })
    seed = await ensureSeed({
      isoPath: seedResult.isoPath,
      imgPath: seedResult.imgPath,
    })
  }
  // --wipe-os needs the domain gone before recreating os.qcow2.
  if (!dryRun && wipeOs && (await which('virsh')) && (await domainExists(connect, name))) {
    console.log(chalk.yellow(`vm: --wipe-os — removing domain ${name} before recreating OS disk`))
    await removeDomain(connect, name)
  }

  const disks = await ensureDisks({
    name,
    baseImage,
    vwSize,
    dataSize,
    specialSize,
    wipeOs,
    wipeTank: false,
    dryRun,
  })

  if (dryRun) {
    const existsHint = wipeOs
      ? 'virt-install (wipe-os)'
      : 'start existing domain if defined, else virt-install'
    const args = buildVirtInstallArgs({
      connect,
      name,
      memory,
      vcpus,
      disks,
      seed,
      ports,
      argv,
      network,
      osinfo,
      serialTcpPort: noConsole ? undefined : 9,
    })
    console.log(chalk.green(`vm: dry-run up → ${existsHint}`))
    console.log(chalk.dim('vm: dry-run virt-install (when domain missing):'))
    console.log(args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' \\\n  '))
    console.log(
      chalk.dim(
        noConsole
          ? '  (no console wait)'
          : `  then wait ≤${timeoutSec}s for cloud-init Final Stage OK/KO (first boot only)`,
      ),
    )
    console.log(`\n${HOST_DEPS}`)
    return
  }

  await requireBins(['virt-install', 'virsh', 'qemu-img'])
  await ensureDefaultNetwork(connect)

  const ac = new AbortController()
  const onSignal = () => ac.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    if (await domainExists(connect, name)) {
      await startExistingDomain({
        connect,
        name,
        ports,
        argv,
        network,
        noConsole,
        timeoutSec,
        signal: ac.signal,
        memory,
        vcpus,
      })
      return
    }

    /** @type {TcpFollow | null} */
    let consoleFollow = null
    try {
      /** @type {number | undefined} */
      let serialTcpPort
      if (!noConsole) {
        consoleFollow = await startSerialTcpFollow({ classify: classifyCloudInitOutcome })
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
        network,
        osinfo,
        serialTcpPort,
      })

      console.log(chalk.cyan('vm: virt-install …'))
      const r = await $`${args}`.nothrow()
      if (r.exitCode !== 0) {
        console.error(String(r.stderr || r.stdout))
        die(`virt-install failed (exit ${r.exitCode})\n\n${HOST_DEPS}`)
      }
      console.log(chalk.green(`vm: domain ${name} created`))

      if (noConsole) {
        await finishAfterConsole({
          connect,
          name,
          ports,
          argv,
          network,
          signal: ac.signal,
        })
        return
      }

      const outcome = await waitForCloudInit(
        /** @type {TcpFollow} */ (consoleFollow),
        timeoutSec,
        ac.signal,
      )
      await /** @type {TcpFollow} */ (consoleFollow).stop()
      consoleFollow = null

      if (outcome.status === 'ok') {
        console.log(chalk.green('vm: cloud-init Final Stage OK'))
        console.log(chalk.dim(`  ${outcome.line}`))
        await finishAfterConsole({
          connect,
          name,
          ports,
          argv,
          network,
          signal: ac.signal,
        })
        return
      }

      console.error(chalk.red('vm: cloud-init Final Stage failed (or timed out)'))
      console.error(chalk.red(`  ${outcome.line}`))
      console.error(chalk.yellow(`vm: domain ${name} left running for diagnosis`))
      // Still detach TCP serial so diagnosis doesn't burn a host CPU.
      await restartWithSerialNull(connect, name)
      process.exitCode = 1
    } finally {
      if (consoleFollow) await consoleFollow.stop()
    }
  } catch (err) {
    if (isAbortError(err) || ac.signal.aborted) {
      console.log(chalk.yellow('vm: up interrupted — domain left running'))
      process.exitCode = 130
      return
    }
    throw err
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}
