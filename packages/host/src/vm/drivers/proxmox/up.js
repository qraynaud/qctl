import { chalk, fs } from 'zx'

import { die } from '../../../lib/util.js'
import { IMAGE } from '../../commands/download.js'
import {
  attachSpecsFromMembers,
  persistentDiskIds,
  summarizeAttachModes,
  withAttachModes,
} from '../../libs/attach-mode.js'
import {
  classifyCloudInitOutcome,
  classifyContinueFirstBoot,
  classifyRebootReady,
} from '../../libs/console.js'
import { clearInstalled, composeScrubSeed, isInstalled } from '../../libs/installed-lifecycle.js'
import {
  assertNameFreeForCreate,
  holderVmName,
  loadDisksFromHolder,
  promoteHolderToAppliance,
} from '../../libs/proxmox/disk-holder.js'
import { createFlagStore } from '../../libs/proxmox/flag-store.js'
import { startProxmoxSerialFollow } from '../../libs/proxmox/serial.js'
import {
  createAndStartRockyVm,
  destroyRockyVm,
  detachAndDeleteSeedIso,
  disksWithReuseVolids,
  ensureCloudImageImport,
  reconcileRockyAppliance,
  restoreProxmoxDisplay,
  uploadSeedIso,
} from '../../libs/proxmox/vm.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { runSeed } from '../../libs/seed/run.js'
import { runVmUp } from '../../libs/up-pipeline.js'
import { clientFrom, ping } from './shared.js'

/** @import { VmUpBackend } from '../../libs/up-pipeline.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @typedef {object} ProxmoxExisting
 * @property {Awaited<ReturnType<typeof clientFrom>>} client
 * @property {number} vmid
 * @property {string} name
 */

/**
 * @typedef {object} ProxmoxCreated
 * @property {Awaited<ReturnType<typeof clientFrom>>} client
 * @property {number} vmid
 * @property {string} name
 * @property {string} isoVolid
 */

/**
 * @returns {Promise<void>}
 */
async function printSshHint() {
  console.log(
    chalk.dim('  next: qctl vm shell --host <guest-ip>  (Proxmox: no local passt hostfwd)'),
  )
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
async function proxmoxDryRun(argv) {
  const { name, env, wipeOs, timeout, noConsole } = argv
  const timeoutSec = timeout || 2700
  const resolved = await resolveProvisionDisks({
    env: env || 'dev',
    target: argv.target || 'proxmox',
    profile: argv.profile,
  })
  console.log(
    chalk.green(
      `vm: dry-run Proxmox up name=${name} env=${env} `
        + `(${summarizeAttachModes(withAttachModes(resolved.members))}`
        + `${wipeOs ? '; wipe-os' : ''})`,
    ),
  )
  console.log(chalk.dim('  would: appliance seed ISO, ensure image'))
  console.log(
    chalk.dim(
      `  if VM exists → reconcile+start; else if holder with persistent disks → promote; `
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
}

/**
 * @param {Awaited<ReturnType<typeof clientFrom>>} client
 * @param {number} vmid
 * @param {string} name
 * @returns {Promise<void>}
 */
async function startProxmoxVm(client, vmid, name) {
  console.log(chalk.cyan(`vm: starting Proxmox VM ${name} (vmid=${vmid})…`))
  const upid = await client.post(
    `/nodes/${encodeURIComponent(client.config.node)}/qemu/${vmid}/status/start`,
    {},
  )
  if (upid) await client.waitTask(upid, { timeoutSec: 120 })
}

/**
 * @returns {VmUpBackend<ProxmoxExisting, ProxmoxCreated>}
 */
function proxmoxBackend() {
  /** @type {Awaited<ReturnType<typeof ping>> | null} */
  let client = null
  /** @type {number | null} */
  let flagVmid = null
  /** @type {ReturnType<typeof createFlagStore> | null} */
  let flags = null
  /** @type {string} */
  let seedEnv = 'dev'
  /**
   * Bound for scrubSeed after probe/create (isoVolid known on create only).
   * @type {{
   *   client: Awaited<ReturnType<typeof ping>>,
   *   vmid: number,
   *   isoVolid: string | null,
   * } | null}
   */
  let scrubTarget = null

  /**
   * @param {Awaited<ReturnType<typeof ping>>} c
   * @param {number} vmid
   * @param {string | null} [isoVolid]
   */
  function bindFlags(c, vmid, isoVolid = null) {
    client = c
    flagVmid = vmid
    flags = createFlagStore(c, vmid)
    scrubTarget = { client: c, vmid, isoVolid }
    return flags
  }

  /**
   * @returns {ReturnType<typeof createFlagStore>}
   */
  function requireFlags() {
    if (!flags || client == null || flagVmid == null) {
      throw new Error('proxmox up: flag store not bound (probe/create did not run)')
    }
    return flags
  }

  return {
    get flags() {
      return flags
    },

    scrubSeed: async () => {
      const target = scrubTarget
      await composeScrubSeed({
        env: seedEnv,
        seedProfile: 'appliance',
        after: async () => {
          if (!target) return
          await detachAndDeleteSeedIso(target.client, target.vmid, target.isoVolid)
        },
      })()
    },

    assertReady: async () => {
      /* attach-mode enforced at create/reconcile */
    },

    dryRun: (argv) => proxmoxDryRun(argv),

    probeExisting: async (argv) => {
      seedEnv = argv.env || 'dev'
      const c = await ping(argv)
      const vmid = await c.findVmidByName(argv.name)
      // Bind early so wipeOs → clearInstalled can delete the tag before recreate.
      if (vmid != null) bindFlags(c, vmid)
      if (argv.wipeOs || vmid == null) return null
      return {
        existing: { client: c, vmid, name: argv.name },
        installed: await isInstalled(requireFlags()),
      }
    },

    reconcile: async (argv, existing) => {
      const { memory, vcpus, env } = argv
      const resolved = await resolveProvisionDisks({
        env: env || 'dev',
        target: argv.target || 'proxmox',
        profile: argv.profile,
      })
      await reconcileRockyAppliance(existing.client, {
        vmid: existing.vmid,
        name: existing.name,
        memory,
        vcpus,
        disks: attachSpecsFromMembers(resolved.members),
      })
    },

    startWithoutSerial: async (_argv, existing) => {
      await startProxmoxVm(existing.client, existing.vmid, existing.name)
      console.log(chalk.green(`vm: Proxmox VM ${existing.name} started`))
    },

    startWithSerial: async (_argv, existing, mode) => {
      await startProxmoxVm(existing.client, existing.vmid, existing.name)
      const classify = mode === 'cloud-init' ? classifyContinueFirstBoot : classifyRebootReady
      return startProxmoxSerialFollow(existing.client, existing.vmid, existing.name, {
        classify,
      })
    },

    finishResumeNoConsole: async (_argv, existing) => {
      await restoreProxmoxDisplay(existing.client, existing.vmid)
      await printSshHint()
    },

    finishResumeOk: async (_argv, existing) => {
      await restoreProxmoxDisplay(existing.client, existing.vmid)
      await printSshHint()
    },

    resumeFailHint: (_argv, existing) =>
      `vm: VM ${existing.name} left running for diagnosis (serial display kept)`,

    createFirstBoot: async (argv, _signal, _opts) => {
      const { name, memory, vcpus, wipeOs, forceDownload, env, cidata } = argv
      seedEnv = env || 'dev'

      const client = await ping(argv)
      let vmid = await client.findVmidByName(name)
      const resolved = await resolveProvisionDisks({
        env: env || 'dev',
        target: argv.target || 'proxmox',
        profile: argv.profile,
      })
      const expectedIds = persistentDiskIds(resolved.members)
      const osSize = resolved.os.size || '20G'
      const diskSpecs = attachSpecsFromMembers(resolved.members)

      // clearInstalled → demote, then seed + create (no re-seed on incomplete).
      if (vmid != null && wipeOs) {
        console.log(
          chalk.yellow(`vm: --wipe-os — demote ${name} to holder, then promote with fresh OS`),
        )
        await clearInstalled(flags ?? createFlagStore(client, vmid))
        await destroyRockyVm(client, { vmid, name, keep: 'persistent' })
        vmid = null
        flags = null
        scrubTarget = null
      }

      console.log(chalk.cyan('vm: building appliance seed…'))
      const seedResult = await runSeed({
        seedProfile: 'appliance',
        profile: argv.profile,
        out: cidata || undefined,
        allowMissingTier0: false,
        allowMissingFiles: false,
        env,
        target: argv.target || 'proxmox',
      })
      const isoPath = seedResult.isoPath
      if (!fs.existsSync(isoPath)) {
        die(`appliance ISO missing at ${isoPath} — run \`qctl vm seed\``)
      }

      const importVolid = await ensureCloudImageImport(client, {
        force: Boolean(forceDownload),
      })
      const isoVolid = await uploadSeedIso(client, isoPath, {
        filename: `rocky-${name}-appliance.iso`,
      })

      const held = await loadDisksFromHolder(client, name)
      const holderReady =
        held && expectedIds.length > 0 && expectedIds.every((id) => held.volids[id])
      if (holderReady) {
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
          osSize,
          expectedIds,
        }))
      } else {
        await assertNameFreeForCreate(client, name)
        console.log(
          chalk.cyan(
            `vm: no complete holder ${holderVmName(name)} — creating fresh VM `
              + `(tank not initialized; run init-tank or create by hand)`,
          ),
        )
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

      bindFlags(client, /** @type {number} */ (vmid), isoVolid)
      return {
        created: { client, vmid: /** @type {number} */ (vmid), name, isoVolid },
        follow: null,
      }
    },

    openSerialAfterCreate: async (_argv, created) =>
      startProxmoxSerialFollow(created.client, created.vmid, created.name, {
        classify: classifyCloudInitOutcome,
      }),

    finishFirstBootNoConsole: async (_argv, created) => {
      await restoreProxmoxDisplay(created.client, created.vmid)
      await printSshHint()
      console.log(chalk.dim(`  image: ${IMAGE.file}`))
      console.log(
        chalk.yellow(
          `  seed ISO left at ${created.isoVolid} (--no-console); delete after first boot or re-run without --no-console`,
        ),
      )
    },

    finishFirstBootOk: async (_argv, created) => {
      // Seed scrub (detach+delete ISO) runs in markInstalled → scrubSeed.
      await restoreProxmoxDisplay(created.client, created.vmid)
      await printSshHint()
      console.log(chalk.dim(`  image: ${IMAGE.file}`))
    },

    firstBootFailHint: (_argv, created) =>
      `vm: VM ${created.name} left running for diagnosis (seed ISO + serial display kept)`,

    finishContinueNoConsole: async (existing) => {
      await restoreProxmoxDisplay(existing.client, existing.vmid)
      await printSshHint()
      console.log(chalk.dim(`  image: ${IMAGE.file}`))
      console.log(
        chalk.yellow(
          '  seed ISO may still be attached (--no-console); delete after first boot or re-run without --no-console',
        ),
      )
    },

    finishContinueOk: async (existing) => {
      // Seed scrub runs in markInstalled → scrubSeed.
      await restoreProxmoxDisplay(existing.client, existing.vmid)
      await printSshHint()
      console.log(chalk.dim(`  image: ${IMAGE.file}`))
    },

    continueFailHint: (existing) =>
      `vm: VM ${existing.name} left running for diagnosis (seed ISO + serial display kept)`,
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function up(argv) {
  await runVmUp(argv, proxmoxBackend())
}
