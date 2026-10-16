import { $, chalk, path } from 'zx'

import { portsFromArgv } from '../../../lib/options.js'
import { getImages } from '../../../lib/paths.js'
import { HOST_DEPS, die, requireBins, which } from '../../../lib/util.js'
import { ensureCloudImage } from '../../../tooling/platform-tooling.js'
import { downloadImage } from '../../commands/download.js'
import { summarizeAttachModes, withAttachModes } from '../../libs/attach-mode.js'
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
  reconcileDomainTpm,
  reconcilePasstPortForwards,
  removeDomain,
  restartWithSerialNull,
  setDomainSerialNull,
  setDomainSerialTcp,
  virsh,
} from '../../libs/libvirt/index.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { ensureSeed } from '../../libs/seed/iso.js'
import { runSeed } from '../../libs/seed/run.js'
import { printLocalSshInfo } from '../../libs/ssh-hints.js'
import { runVmUp } from '../../libs/up-pipeline.js'
import { buildVirtInstallArgs } from '../../libs/virt-install.js'
import { sleep, waitForLocalTcpPorts } from '../../libs/wait.js'

/** @import { SerialFollow } from '../../libs/console.js' */
/** @import { VmUpBackend } from '../../libs/up-pipeline.js' */
/** @import { PortsMap, VmArgv } from '../../types.js' */

/** @typedef {Awaited<ReturnType<typeof startSerialTcpFollow>>} TcpFollow */

/**
 * @typedef {object} LocalSession
 * @property {VmArgv} argv
 * @property {string} connect
 * @property {string} name
 * @property {number} memory
 * @property {number} vcpus
 * @property {string} network
 * @property {string} osinfo
 * @property {PortsMap} ports
 * @property {Awaited<ReturnType<typeof ensureDisks>>} disks
 * @property {Awaited<ReturnType<typeof ensureSeed>>} seed
 * @property {string | null} [state]
 */

/**
 * @typedef {LocalSession} LocalExisting
 * @typedef {LocalSession} LocalCreated
 */

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
 * @param {LocalSession} session
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function finishAfterConsole(session, signal) {
  const { connect, name, ports, network } = session
  await restartWithSerialNull(connect, name)
  if (network !== 'default') {
    const sshFwd = ports.ssh?.forward
    const cockpitFwd = ports.cockpit?.forward
    const forwards = [sshFwd, cockpitFwd].filter((p) => p != null)
    await waitForLocalTcpPorts({
      ports: forwards,
      sshPorts: sshFwd != null ? [sshFwd] : [],
      signal,
      label: 'SSH + Cockpit',
      timeoutSec: 180,
    })
  }
  await printLocalSshInfo({ connect, name, ports, network })
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<LocalSession>}
 */
async function prepareLocalUp(argv) {
  const {
    name,
    connect,
    memory,
    vcpus,
    network: networkArg,
    osinfo,
    wipeOs,
    forceDownload,
    cidata,
    env,
  } = argv
  const network = networkArg === 'auto' ? 'user' : networkArg
  const ports = portsFromArgv(argv)
  const resolved = await resolveProvisionDisks({
    env: env || 'dev',
    target: argv.target || 'local',
  })

  console.log(
    chalk.dim(
      `  connect=${connect}; disks: ${summarizeAttachModes(withAttachModes(resolved.members))}`,
    ),
  )

  const baseImage = await downloadImage({
    force: forceDownload,
    env: env || 'dev',
    target: 'local',
  })

  console.log(chalk.cyan('vm: building appliance seed…'))
  const seedResult = await runSeed({
    seedProfile: 'appliance',
    profile: argv.profile,
    out: cidata || undefined,
    allowMissingTier0: false,
    allowMissingFiles: false,
    env: env || 'dev',
    target: argv.target || 'local',
  })
  const seed = await ensureSeed({
    isoPath: seedResult.isoPath,
    imgPath: seedResult.imgPath,
  })

  if (wipeOs && (await which('virsh')) && (await domainExists(connect, name))) {
    console.log(chalk.yellow(`vm: --wipe-os — removing domain ${name} before recreating OS disk`))
    await removeDomain(connect, name)
  }

  const disks = await ensureDisks({
    name,
    baseImage,
    resolved,
    wipeOs,
    wipeTank: false,
    dryRun: false,
  })

  await requireBins(['virt-install', 'virsh', 'qemu-img', 'swtpm'])
  await ensureDefaultNetwork(connect)

  return {
    argv,
    connect,
    name,
    memory,
    vcpus,
    network,
    osinfo,
    ports,
    disks,
    seed,
    state: null,
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
async function localDryRun(argv) {
  const {
    name,
    connect,
    memory,
    vcpus,
    network: networkArg,
    osinfo,
    wipeOs,
    timeout,
    noConsole,
    env,
  } = argv
  const network = networkArg === 'auto' ? 'user' : networkArg
  const timeoutSec = timeout
  const ports = portsFromArgv(argv)
  const resolved = await resolveProvisionDisks({
    env: env || 'dev',
    target: argv.target || 'local',
  })

  console.log(
    chalk.dim(
      `  connect=${connect}; disks: ${summarizeAttachModes(withAttachModes(resolved.members))}`,
    ),
  )
  const pin = await ensureCloudImage({ env: env || 'dev', target: 'local' })
  const baseImage = path.join(getImages(), pin.file)
  console.log(chalk.dim(`vm: dry-run skip download (expect ${baseImage})`))
  const seed = { path: 'seed/<env>/nocloud.iso', format: 'raw', device: 'cdrom' }
  const disks = await ensureDisks({
    name,
    baseImage,
    resolved,
    wipeOs,
    wipeTank: false,
    dryRun: true,
  })
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
}

/**
 * @param {{ session: LocalSession | null }} state
 * @returns {VmUpBackend<LocalExisting, LocalCreated>}
 */
function localBackend(state) {
  return {
    dryRun: (argv) => localDryRun(argv),

    prepare: async (argv) => {
      state.session = await prepareLocalUp(argv)
    },

    findRunnableExisting: async () => {
      if (!state.session) throw new Error('local up: prepare() did not run')
      if (!(await domainExists(state.session.connect, state.session.name))) return null
      return state.session
    },

    reconcile: async (_argv, existing) => {
      let state = await waitUntilNotShuttingDown(existing.connect, existing.name)

      if (existing.network === 'user') {
        const changed = await reconcilePasstPortForwards(
          existing.connect,
          existing.name,
          existing.ports,
        )
        if (changed) state = await waitUntilNotShuttingDown(existing.connect, existing.name)
      }
      {
        const changed = await reconcileDomainResources(existing.connect, existing.name, {
          memory: existing.memory,
          vcpus: existing.vcpus,
        })
        if (changed) state = await waitUntilNotShuttingDown(existing.connect, existing.name)
      }
      {
        const changed = await reconcileDomainTpm(existing.connect, existing.name)
        if (changed) state = await waitUntilNotShuttingDown(existing.connect, existing.name)
      }

      existing.state = state
    },

    isAlreadyUp: (_argv, existing) => existing.state === 'running',

    startWithoutSerial: async (_argv, existing) => {
      const { connect, name, state } = existing
      if (state !== 'shut off') {
        die(
          `domain ${name} is ${state || 'missing'} — expected shut off after down; `
            + `use destroy (--keep-persistent) then up, or --wipe-os to recreate`,
        )
      }
      await setDomainSerialNull(connect, name)
      console.log(chalk.cyan(`vm: starting existing domain ${name}…`))
      const r = await virsh(connect, 'start', name).nothrow()
      if (r.exitCode !== 0) {
        die(`virsh start failed: ${String(r.stderr || r.stdout).trim()}`)
      }
      console.log(chalk.green(`vm: domain ${name} started`))
    },

    startWithSerial: async (_argv, existing) => {
      const { connect, name, state } = existing
      if (state !== 'shut off') {
        die(
          `domain ${name} is ${state || 'missing'} — expected shut off after down; `
            + `use destroy (--keep-persistent) then up, or --wipe-os to recreate`,
        )
      }
      const follow = await startSerialTcpFollow({ classify: classifyRebootReady })
      await setDomainSerialTcp(connect, name, follow.port)
      console.log(chalk.cyan(`vm: starting existing domain ${name}…`))
      const r = await virsh(connect, 'start', name).nothrow()
      if (r.exitCode !== 0) {
        await follow.stop()
        die(`virsh start failed: ${String(r.stderr || r.stdout).trim()}`)
      }
      console.log(chalk.green(`vm: domain ${name} started`))
      return follow
    },

    finishResumeNoConsole: async (_argv, existing) => {
      await printLocalSshInfo({
        connect: existing.connect,
        name: existing.name,
        ports: existing.ports,
        network: existing.network,
      })
    },

    finishResumeOk: async (_argv, existing) => {
      if (existing.state === 'running') {
        console.log(chalk.green(`vm: domain ${existing.name} already running`))
        await printLocalSshInfo({
          connect: existing.connect,
          name: existing.name,
          ports: existing.ports,
          network: existing.network,
        })
        return
      }
      await restartWithSerialNull(existing.connect, existing.name)
      await printLocalSshInfo({
        connect: existing.connect,
        name: existing.name,
        ports: existing.ports,
        network: existing.network,
      })
    },

    resumeFailHint: (_argv, existing) => `vm: domain ${existing.name} left running for diagnosis`,

    createFirstBoot: async (_argv, _signal, { wantSerial }) => {
      if (!state.session) throw new Error('local up: prepare() did not run')
      const { connect, name, memory, vcpus, disks, seed, ports, network, osinfo } = state.session

      /** @type {TcpFollow | null} */
      let follow = null
      /** @type {number | undefined} */
      let serialTcpPort
      if (wantSerial) {
        follow = await startSerialTcpFollow({ classify: classifyCloudInitOutcome })
        serialTcpPort = follow.port
      }

      const args = buildVirtInstallArgs({
        connect,
        name,
        memory,
        vcpus,
        disks,
        seed,
        ports,
        network,
        osinfo,
        serialTcpPort,
      })

      console.log(chalk.cyan('vm: virt-install …'))
      const r = await $`${args}`.nothrow()
      if (r.exitCode !== 0) {
        if (follow) await follow.stop()
        console.error(String(r.stderr || r.stdout))
        die(`virt-install failed (exit ${r.exitCode})\n\n${HOST_DEPS}`)
      }
      console.log(chalk.green(`vm: domain ${name} created`))

      return { created: state.session, follow: /** @type {SerialFollow | null} */ (follow) }
    },

    finishFirstBootNoConsole: async (_argv, created, signal) => {
      await finishAfterConsole(created, signal)
    },

    finishFirstBootOk: async (_argv, created, signal) => {
      await finishAfterConsole(created, signal)
    },

    finishFirstBootFail: async (_argv, created) => {
      await restartWithSerialNull(created.connect, created.name)
    },

    firstBootFailHint: (_argv, created) => `vm: domain ${created.name} left running for diagnosis`,
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function up(argv) {
  /** @type {{ session: LocalSession | null }} */
  const state = { session: null }
  await runVmUp(argv, localBackend(state))
}
