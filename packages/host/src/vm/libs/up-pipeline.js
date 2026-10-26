/**
 * Shared appliance / init-tank orchestration over a thin {@link VmDriverModule}.
 * Product modes are separate entrypoints — not lifecycle flags on the module.
 */
import { chalk } from 'zx'

import {
  QCTL_READY_SETTLE_MS,
  classifyCloudInitOutcome,
  classifyContinueFirstBoot,
  isQctlReadyLine,
  matchInitTankFatal,
} from './console.js'
import { composeScrubSeed, isInstalled, markInstalled } from './installed-lifecycle.js'
import {
  buildCreateSpec,
  dryRunUp,
  ensureDisksForCreate,
  prepareHostForUp,
  resolveBaseOsImage,
} from './up-prepare.js'
import { isAbortError, sleep, waitForSerialOutcome } from './wait.js'

/**
 * @import {
 *   VmContext,
 *   VmDisksSpec,
 *   VmDriverId,
 *   VmDriverRegistration,
 *   VmInitTankOptions,
 *   VmSpecs,
 *   VmUpOptions,
 * } from '../driver-contract.js'
 */
/** @import { SerialFollow, SerialWaitOutcome } from './console.js' */
/** @import { VmFlagStore } from './flag-store.js' */
/** @import { HostCreatePrep } from './up-prepare.js' */

const CLOUD_INIT_WAIT = {
  /** @param {number} timeoutSec */
  waiting: (timeoutSec) => `vm: waiting for QCTL_READY (first-boot stamp; timeout ${timeoutSec}s)…`,
  /** @param {number} timeoutSec */
  timeoutLine: (timeoutSec) => `QCTL_READY not seen within ${timeoutSec}s`,
}

const CONTINUE_WAIT = {
  /** @param {number} timeoutSec */
  waiting: (timeoutSec) =>
    `vm: waiting for first-boot continue (QCTL_READY or multi-user; timeout ${timeoutSec}s)…`,
  /** @param {number} timeoutSec */
  timeoutLine: (timeoutSec) => `first-boot continue not seen within ${timeoutSec}s`,
}

/**
 * @param {(signal: AbortSignal) => Promise<void>} fn
 * @returns {Promise<void>}
 */
export async function withUpSignals(fn) {
  const ac = new AbortController()
  const onSignal = () => ac.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    await fn(ac.signal)
  } catch (err) {
    if (isAbortError(err) || ac.signal.aborted) {
      console.log(chalk.yellow('vm: up interrupted — left running'))
      process.exitCode = 130
      return
    }
    throw err
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

/**
 * @param {SerialWaitOutcome} outcome
 * @param {{ okTitle: string, failTitle: string, leaveHint: string }} labels
 * @returns {boolean}
 */
export function reportSerialWaitOutcome(outcome, labels) {
  if (outcome.status === 'ok') {
    console.log(chalk.green(labels.okTitle))
    console.log(chalk.dim(`  ${outcome.line}`))
    return true
  }
  console.error(chalk.red(labels.failTitle))
  console.error(chalk.red(`  ${outcome.line}`))
  console.error(chalk.yellow(labels.leaveHint))
  process.exitCode = 1
  return false
}

/**
 * @param {SerialFollow} follow
 * @param {number} timeoutSec
 * @param {AbortSignal} signal
 * @param {{ waiting: (n: number) => string, timeoutLine: (n: number) => string }} msgs
 * @returns {Promise<SerialWaitOutcome>}
 */
async function waitSerial(follow, timeoutSec, signal, msgs) {
  return waitForSerialOutcome(follow, timeoutSec, signal, {
    waiting: msgs.waiting(timeoutSec),
    timeoutLine: msgs.timeoutLine(timeoutSec),
  })
}

/**
 * After stamp-gated `QCTL_READY`, pause before tearing down serial / restarting
 * so the guest can finish Final Stage modules and flush stamps.
 *
 * @param {SerialWaitOutcome} outcome
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
async function settleAfterQctlReady(outcome, signal) {
  if (outcome.status !== 'ok' || !isQctlReadyLine(outcome.line)) return
  console.log(
    chalk.dim(`vm: QCTL_READY seen — settling ${QCTL_READY_SETTLE_MS / 1000}s before detach…`),
  )
  await sleep(QCTL_READY_SETTLE_MS, signal)
}

/**
 * @typedef {object} UpModule
 * @property {VmDriverId} id
 * @property {NonNullable<VmDriverRegistration['find']>} find
 * @property {NonNullable<VmDriverRegistration['create']>} create
 * @property {NonNullable<VmDriverRegistration['start']>} start
 * @property {NonNullable<VmDriverRegistration['createFlagStore']>} createFlagStore
 * @property {NonNullable<VmDriverRegistration['detachSeed']>} detachSeed
 * @property {NonNullable<VmDriverRegistration['destroy']>} destroy
 * @property {NonNullable<VmDriverRegistration['reconcile']>} reconcile
 * @property {NonNullable<VmDriverRegistration['powerState']>} powerState
 * @property {VmDriverRegistration['resolveEndpoint']} [resolveEndpoint]
 */

/**
 * @param {VmDriverRegistration} module
 * @returns {asserts module is UpModule}
 */
function assertUpModule(module) {
  if (
    !module.find
    || !module.create
    || !module.start
    || !module.createFlagStore
    || !module.detachSeed
    || !module.destroy
    || !module.reconcile
    || !module.powerState
  ) {
    throw new Error(
      `runVmUp: module ${module.id} missing thin ops (find/create/start/createFlagStore/…)`,
    )
  }
}

/**
 * @param {UpModule} module
 * @param {VmContext} ctx
 * @returns {Promise<() => Promise<void>>}
 */
async function scrubSeedFn(module, ctx) {
  return composeScrubSeed({
    env: ctx.env,
    seedProfile: 'appliance',
    after: async () => {
      const vm = await module.find(ctx)
      if (vm) await module.detachSeed(ctx, vm)
    },
  })
}

/**
 * @param {UpModule} module
 * @param {VmContext} ctx
 * @param {number} timeoutSec
 * @param {AbortSignal} signal
 */
async function waitPoweroff(module, ctx, timeoutSec, signal) {
  const deadline = Date.now() + timeoutSec * 1000
  console.log(chalk.cyan(`vm: waiting for guest poweroff (timeout ${timeoutSec}s)…`))
  let attempt = 0
  while (Date.now() < deadline) {
    if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    attempt += 1
    const st = await module.powerState(ctx)
    if (!st || st.kind === 'absent' || st.kind === 'stopped') {
      console.log(chalk.green('vm: guest shut off (init-tank finished)'))
      return
    }
    if (attempt === 1 || attempt % 6 === 0) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      console.log(chalk.dim(`vm: power=${st.kind} (${left}s left)`))
    }
    await sleep(5000, signal)
  }
  throw new Error(`guest still running after ${timeoutSec}s — init-tank prep likely failed`)
}

/**
 * @param {VmDriverRegistration} module
 * @param {VmContext} ctx
 * @param {Partial<VmSpecs>} specs
 */
async function printUpHints(module, ctx, specs) {
  try {
    if (!module.resolveEndpoint) return
    const ep = await module.resolveEndpoint(ctx, { network: specs.network })
    if (ep) console.log(chalk.dim(`  ssh: ${ep.label}`))
  } catch {
    /* proxmox without --host, etc. */
  }
}

/**
 * Appliance up (persistent). Host handles wipe-os via {@link runVmDestroy} before calling.
 *
 * @param {VmContext} ctx
 * @param {VmUpOptions & { forceDownload?: boolean, wipeOs?: boolean }} opts
 *   `forceDownload` / `wipeOs` are host prep only (CLI); not driver contract fields.
 * @param {VmDriverRegistration} module
 * @param {Partial<VmSpecs>} specs
 * @returns {Promise<void>}
 */
export async function runVmUp(ctx, opts, module, specs) {
  assertUpModule(module)
  const mod = /** @type {UpModule} */ (module)
  const timeoutSec = opts.timeout || ctx.timeout || 2700
  const followConsole = Boolean(opts.console)
  /** @type {HostCreatePrep} */
  const prep = {
    seedProfile: 'appliance',
    forceDownload: Boolean(/** @type {{ forceDownload?: boolean }} */ (opts).forceDownload),
    wipeOs: Boolean(/** @type {{ wipeOs?: boolean }} */ (opts).wipeOs),
  }

  if (ctx.dryRun) {
    await dryRunUp(mod, ctx, prep)
    return
  }

  await prepareHostForUp(mod, ctx)

  await withUpSignals(async (signal) => {
    await runPersistentUp(ctx, prep, mod, specs, timeoutSec, followConsole, signal)
  })
}

/**
 * Init-tank: find→reconcile(disks) or create(disk plan) → start → wait →
 * reconcile(disks without boot) or destroy(keepDisks=persistent+os).
 *
 * @param {VmContext} ctx
 * @param {VmInitTankOptions & { forceDownload?: boolean }} opts
 * @param {VmDriverRegistration} module
 * @param {Partial<VmSpecs>} specs
 * @returns {Promise<void>}
 */
export async function runVmInitTank(ctx, opts, module, specs) {
  assertUpModule(module)
  const mod = /** @type {UpModule} */ (module)
  const timeoutSec = opts.timeout || ctx.timeout || 2700
  const followConsole = Boolean(opts.console)
  /** @type {HostCreatePrep} */
  const prep = {
    seedProfile: 'init-tank',
    forceDownload: Boolean(/** @type {{ forceDownload?: boolean }} */ (opts).forceDownload),
    poolIds: opts.poolIds,
    force: opts.force,
  }

  if (ctx.dryRun) {
    await dryRunUp(mod, ctx, prep)
    return
  }

  await prepareHostForUp(mod, ctx)

  await withUpSignals(async (signal) => {
    await runEphemeralUp(ctx, prep, mod, specs, timeoutSec, followConsole, signal)
  })
}

/**
 * @param {VmContext} ctx
 * @param {HostCreatePrep} prep
 * @param {UpModule} module
 * @param {Partial<VmSpecs>} specs
 * @param {number} timeoutSec
 * @param {boolean} followConsole
 * @param {AbortSignal} signal
 */
async function runPersistentUp(ctx, prep, module, specs, timeoutSec, followConsole, signal) {
  const scrubSeed = await scrubSeedFn(module, ctx)

  /** @returns {Promise<VmFlagStore>} */
  async function flags() {
    return module.createFlagStore(ctx)
  }

  let vm = await module.find(ctx)
  const installed = vm ? await isInstalled(await flags()) : false

  if (vm && installed) {
    await module.reconcile(ctx, vm, specs)
    const power = await module.powerState(ctx)
    if (power.kind === 'running') {
      console.log(chalk.green(`vm: ${ctx.name} already running`))
      await printUpHints(module, ctx, specs)
      return
    }
    await module.start(ctx, vm, { serial: false })
    console.log(chalk.green(`vm: ${ctx.name} started`))
    await printUpHints(module, ctx, specs)
    return
  }

  if (vm && !installed) {
    console.log(chalk.cyan('vm: existing VM not marked installed — continuing first-boot'))
    /** @type {SerialFollow | null} */
    let follow = null
    try {
      if (!followConsole) {
        await module.start(ctx, vm, { serial: false })
        await markInstalled(await flags(), { scrubSeed })
        await printUpHints(module, ctx, specs)
        return
      }
      follow = await module.start(ctx, vm, {
        serial: true,
        classify: classifyContinueFirstBoot,
      })
      if (!follow) throw new Error('vm up: start(serial) returned no follow')
      console.log(chalk.green('vm: started — streaming serial until first-boot continue'))
      const outcome = await waitSerial(follow, timeoutSec, signal, CONTINUE_WAIT)
      await settleAfterQctlReady(outcome, signal)
      await follow.stop()
      follow = null
      if (
        reportSerialWaitOutcome(outcome, {
          okTitle: 'vm: first-boot continue OK',
          failTitle: 'vm: first-boot continue failed (or timed out)',
          leaveHint: `vm: ${ctx.name} left running for diagnosis`,
        })
      ) {
        await markInstalled(await flags(), { scrubSeed })
        await module.start(ctx, vm, { serial: false })
        await printUpHints(module, ctx, specs)
      }
    } finally {
      if (follow) await follow.stop()
    }
    return
  }

  const baseOsImage = await resolveBaseOsImage(module, ctx, prep)
  const diskExtras = await ensureDisksForCreate(module, ctx, prep, baseOsImage)
  const spec = await buildCreateSpec(module, ctx, specs, prep, baseOsImage, diskExtras)
  vm = await module.create(ctx, spec, signal)

  /** @type {SerialFollow | null} */
  let follow = null
  try {
    if (!followConsole) {
      await module.start(ctx, vm, { serial: false })
      await markInstalled(await flags(), { scrubSeed })
      await printUpHints(module, ctx, specs)
      return
    }
    follow = await module.start(ctx, vm, {
      serial: true,
      classify: classifyCloudInitOutcome,
    })
    if (!follow) throw new Error('vm up: start(serial) returned no follow')
    console.log(chalk.green('vm: started — streaming serial until QCTL_READY (first-boot stamp)'))
    const outcome = await waitSerial(follow, timeoutSec, signal, CLOUD_INIT_WAIT)
    await settleAfterQctlReady(outcome, signal)
    await follow.stop()
    follow = null
    if (
      reportSerialWaitOutcome(outcome, {
        okTitle: 'vm: first-boot OK (QCTL_READY)',
        failTitle: 'vm: first-boot failed (or timed out)',
        leaveHint: `vm: ${ctx.name} left running for diagnosis`,
      })
    ) {
      await markInstalled(await flags(), { scrubSeed })
      await module.start(ctx, vm, { serial: false })
      await printUpHints(module, ctx, specs)
    } else {
      await module.start(ctx, vm, { serial: false })
    }
  } finally {
    if (follow) await follow.stop()
  }
}

/**
 * @param {VmContext} ctx
 * @param {HostCreatePrep} prep
 * @param {UpModule} module
 * @param {Partial<VmSpecs>} specs
 * @param {number} timeoutSec
 * @param {boolean} followConsole
 * @param {AbortSignal} signal
 */
async function runEphemeralUp(ctx, prep, module, specs, timeoutSec, followConsole, signal) {
  const baseOsImage = await resolveBaseOsImage(module, ctx, prep)
  const diskExtras = await ensureDisksForCreate(module, ctx, prep, baseOsImage)
  if (String(module.id) === 'workstation' && !diskExtras.bootDiskPath) {
    return
  }
  const spec = await buildCreateSpec(module, ctx, specs, prep, baseOsImage, diskExtras)

  let vm = await module.find(ctx)
  const inplace = Boolean(vm)
  if (vm) {
    await module.reconcile(ctx, vm, spec)
  } else {
    vm = await module.create(ctx, spec, signal)
  }

  /** @type {SerialFollow | null} */
  let follow = null
  try {
    if (followConsole) {
      follow = await module.start(ctx, vm, {
        serial: true,
        classify: (line) => {
          const fatal = matchInitTankFatal(line)
          if (fatal) return { status: 'fail', line: fatal }
          return null
        },
      })
    } else {
      await module.start(ctx, vm, { serial: false })
    }

    if (follow) {
      const powerPromise = waitPoweroff(module, ctx, timeoutSec, signal).then(
        () => /** @type {const} */ ('poweroff'),
      )
      const serialPromise = follow.result.then((o) => /** @type {const} */ ({ kind: 'serial', o }))
      const winner = await Promise.race([powerPromise, serialPromise])
      await follow.stop()
      follow = null
      if (winner !== 'poweroff' && winner.kind === 'serial' && winner.o.status === 'fail') {
        console.error(chalk.red('vm: init-tank guest fatal'))
        console.error(chalk.red(`  ${winner.o.line}`))
        process.exitCode = 1
        return
      }
    } else {
      await waitPoweroff(module, ctx, timeoutSec, signal)
    }

    await module.detachSeed(ctx, vm)
    if (inplace) {
      // Drop disposable boot; keep remaining labels (provision disks).
      /** @type {VmDisksSpec} */
      const disks = Object.fromEntries(
        Object.entries(spec.disks).filter(([label]) => label !== spec.bootDrive),
      )
      const withoutBoot = {
        memory: spec.memory,
        vcpus: spec.vcpus,
        network: spec.network,
        osinfo: spec.osinfo,
        disks,
        bootDrive: Object.keys(disks)[0],
      }
      await module.reconcile(ctx, vm, withoutBoot)
      console.log(chalk.green('vm: init-tank done (appliance kept; disposable boot removed)'))
    } else {
      // Ephemeral guest: undefine but keep every label from the plan except boot.
      const keepDisks = Object.keys(spec.disks).filter((label) => label !== spec.bootDrive)
      // Also keep provision os if present on disk but omitted from init-tank plan.
      const { persistentDiskLabels } = await import('./disk-plan.js')
      const { resolveProvisionDisks } = await import('./resolve-provision-disks.js')
      const resolved = await resolveProvisionDisks({
        env: ctx.env || 'dev',
        target: String(module.id),
        profile: ctx.profile,
      })
      const osLabel = resolved.os.id
      const keep = [...new Set([...keepDisks, osLabel, ...persistentDiskLabels(resolved)])]
      await module.destroy(ctx, { keepDisks: keep })
      console.log(chalk.green('vm: init-tank done (ephemeral guest removed; disks kept)'))
    }
  } finally {
    if (follow) await follow.stop()
  }
}
