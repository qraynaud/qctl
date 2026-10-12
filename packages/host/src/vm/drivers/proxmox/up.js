import { chalk, fs } from 'zx'

import { DATA_COUNT, SPECIAL_COUNT } from '../../../lib/paths.js'
import { assertProxmoxDiskPlan } from '../../../lib/target.js'
import { die } from '../../../lib/util.js'
import { IMAGE } from '../../commands/download.js'
import { classifyCloudInitOutcome, classifyRebootReady } from '../../libs/console.js'
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
  console.log(chalk.dim(`  (Proxmox: SSH via guest IP / PVE net; no local passt hostfwd)`))
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
async function proxmoxDryRun(argv) {
  const { name, env, wipeOs, timeout, noConsole } = argv
  const timeoutSec = timeout || 2700
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
  return {
    assertReady: (argv) => {
      assertProxmoxDiskPlan({ target: argv.target || 'proxmox', env: argv.env })
    },

    dryRun: (argv) => proxmoxDryRun(argv),

    findRunnableExisting: async (argv) => {
      if (argv.wipeOs) return null
      const client = await ping(argv)
      const vmid = await client.findVmidByName(argv.name)
      if (vmid == null) return null
      return { client, vmid, name: argv.name }
    },

    reconcile: async (argv, existing) => {
      const { memory, vcpus, vwSize, dataSize, specialSize } = argv
      await reconcileRockyAppliance(existing.client, {
        vmid: existing.vmid,
        name: existing.name,
        memory,
        vcpus,
        vwSize,
        dataSize,
        specialSize,
      })
    },

    startWithoutSerial: async (_argv, existing) => {
      await startProxmoxVm(existing.client, existing.vmid, existing.name)
      console.log(chalk.green(`vm: Proxmox VM ${existing.name} started`))
    },

    startWithSerial: async (_argv, existing) => {
      await startProxmoxVm(existing.client, existing.vmid, existing.name)
      return startProxmoxSerialFollow(existing.client, existing.vmid, existing.name, {
        classify: classifyRebootReady,
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
      const {
        name,
        memory,
        vcpus,
        vwSize,
        dataSize,
        specialSize,
        wipeOs,
        forceDownload,
        env,
        cidata,
      } = argv

      const client = await ping(argv)
      let vmid = await client.findVmidByName(name)

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
      await detachAndDeleteSeedIso(created.client, created.vmid, created.isoVolid)
      await restoreProxmoxDisplay(created.client, created.vmid)
      await printSshHint()
      console.log(chalk.dim(`  image: ${IMAGE.file}`))
    },

    firstBootFailHint: (_argv, created) =>
      `vm: VM ${created.name} left running for diagnosis (seed ISO + serial display kept)`,
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function up(argv) {
  await runVmUp(argv, proxmoxBackend())
}
