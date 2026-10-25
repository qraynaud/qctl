/**
 * Thin workstation (libvirt) hypervisor ops for {@link VmDriverModule}.
 */
import { chalk, fs } from 'zx'

import { portsFromArgv } from '../../../lib/options.js'
import { portByName } from '../../../lib/ports.js'
import { die, requireBins } from '../../../lib/util.js'
import { workstationSchema } from '../../../provision/schema/targets.js'
import { startSerialTcpFollow } from '../../libs/console.js'
import { defaultQcowPath, toVmDiskPlan } from '../../libs/disk-plan.js'
import { INIT_TANK_BOOT_ID, removeInitTankBootDisk } from '../../libs/init-tank-boot.js'
import {
  attachInitTankBootDisk,
  detachInitTankBootDisk,
  detachSeedCdrom,
  domainExists,
  domainState,
  reconcileDomainResources,
  reconcilePasstPortForwards,
  removeDomain,
  setDomainSerialNull,
  setDomainSerialTcp,
  virsh,
} from '../../libs/libvirt/index.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { ensureSeed } from '../../libs/seed/iso.js'
import { buildVirtInstallArgs, defineDomainFromVirtInstallArgs } from '../../libs/virt-install.js'

/**
 * @import {
 *   ResolveEndpointOptions,
 *   SyncEndpoint,
 *   VmCheckFacts,
 *   VmContext,
 *   VmDestroyOptions,
 *   VmPowerState,
 *   VmSpecs,
 * } from '../../driver-contract.js'
 */
/** @import { SerialFollow } from '../../libs/console.js' */

/**
 * @typedef {object} WorkstationHandle
 * @property {string} connect
 * @property {string} name
 */

export const provisionOverlaySchema = workstationSchema

/**
 * @param {VmContext} ctx
 * @returns {string}
 */
export function connectOf(ctx) {
  return ctx.connect != null && String(ctx.connect).trim() !== ''
    ? String(ctx.connect).trim()
    : process.env.QCTL_LIBVIRT_URI || 'qemu:///system'
}

/**
 * @param {VmContext} ctx
 * @returns {Promise<WorkstationHandle | null>}
 */
export async function find(ctx) {
  const connect = connectOf(ctx)
  const name = String(ctx.name).trim()
  if (!(await domainExists(connect, name))) return null
  return { connect, name }
}

/**
 * @param {VmContext} ctx
 * @returns {Promise<VmPowerState>}
 */
export async function powerState(ctx) {
  if (ctx.dryRun) return { kind: 'absent', detail: 'dry-run' }
  const state = await domainState(connectOf(ctx), String(ctx.name).trim())
  if (state == null) return { kind: 'absent' }
  if (state === 'running') return { kind: 'running', detail: state }
  return { kind: 'stopped', detail: state }
}

/**
 * Guest IPv4 from libvirt DHCP lease (network=default).
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<string | null>}
 */
async function localLeaseIp(connect, name) {
  const lease = await virsh(connect, 'domifaddr', name, '--source', 'lease').nothrow()
  if (lease.exitCode !== 0) return null
  const m = String(lease.stdout).match(/(\d+\.\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

/**
 * @param {VmContext} ctx
 * @param {ResolveEndpointOptions} [opts]
 * @returns {Promise<SyncEndpoint>}
 */
export async function resolveEndpoint(ctx, opts = {}) {
  const name = String(ctx.name).trim()
  const username = (opts.user || 'rocky').trim() || 'rocky'
  const remoteDir = (opts.remoteDir || '/tank/rocky').trim() || '/tank/rocky'
  const identity = opts.identity?.trim() || undefined
  const rawNetwork = opts.network ?? 'user'
  const network = rawNetwork === 'auto' ? 'user' : rawNetwork

  if (opts.host?.trim()) {
    const host = opts.host.trim()
    const port = opts.port != null ? Number(opts.port) : 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`--port must be 1–65535 (got ${opts.port})`)
    }
    return {
      host,
      port,
      username,
      remoteDir,
      identity,
      label: `${username}@${host}:${port} (workstation/${ctx.env || 'dev'}) → ${remoteDir}`,
    }
  }

  const connect = connectOf(ctx)
  if (network === 'default') {
    const ip = await localLeaseIp(connect, name)
    if (!ip) {
      throw new Error(
        `no DHCP lease for ${name} yet (network=default).\n`
          + `  Wait for boot, or use --network user / --host.`,
      )
    }
    const port = opts.port != null ? Number(opts.port) : 22
    return {
      host: ip,
      port,
      username,
      remoteDir,
      identity,
      label: `${username}@${ip}:${port} (workstation/default) → ${remoteDir}`,
    }
  }

  const ports = portsFromArgv({
    env: ctx.env,
    target: 'workstation',
    profile: ctx.profile,
  })
  const forward = portByName(ports, 'ssh').forward
  if (forward == null) {
    throw new Error(
      'no ssh.forward in provision networking.ports (passt).\n'
        + '  Set networking.ports.ssh.forward, or pass --host / --port.',
    )
  }
  const port = opts.port != null ? Number(opts.port) : forward
  return {
    host: '127.0.0.1',
    port,
    username,
    remoteDir,
    identity,
    label: `${username}@127.0.0.1:${port} (workstation/user) → ${remoteDir}`,
  }
}

/**
 * Patch guest from {@link VmSpecs} — only listed fields change.
 * @param {VmContext} ctx
 * @param {WorkstationHandle} vm
 * @param {Partial<VmSpecs>} [specs]
 * @returns {Promise<void>}
 */
export async function reconcile(ctx, vm, specs) {
  if (!specs) return

  if (specs.disks) {
    await convergeWorkstationDisks(vm, specs, specs.seedIsoPath)
  }

  if (specs.network != null) {
    const network = specs.network === 'auto' ? 'user' : specs.network || 'user'
    if (network === 'user') {
      const ports = portsFromArgv({
        env: ctx.env,
        target: 'workstation',
        profile: ctx.profile,
      })
      await reconcilePasstPortForwards(vm.connect, vm.name, ports)
    }
  }

  if (specs.memory != null && specs.vcpus != null) {
    await reconcileDomainResources(vm.connect, vm.name, {
      memory: specs.memory,
      vcpus: specs.vcpus,
    })
  }
}

/**
 * Converge labeled disks: attach missing (bootDrive first), detach extras.
 * @param {WorkstationHandle} vm
 * @param {Pick<Partial<VmSpecs>, 'disks' | 'bootDrive'>} plan
 * @param {string} [seedIsoPath]
 */
async function convergeWorkstationDisks(vm, plan, seedIsoPath) {
  const disks = plan.disks || {}
  const desired = new Set(Object.keys(disks))
  const dump = await virsh(vm.connect, 'dumpxml', vm.name).nothrow()
  if (dump.exitCode !== 0) {
    die(`workstation reconcile: dumpxml failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  const xml = String(dump.stdout)
  const present = new Set(
    [...xml.matchAll(/<serial>\s*([^<]+)\s*<\/serial>/gi)].map((m) => m[1].trim()),
  )

  for (const label of present) {
    if (desired.has(label) || label === 'cidata') continue
    if (label === INIT_TANK_BOOT_ID || !desired.has(label)) {
      // detach extras via serial-specific helper when it's the disposable boot;
      // other extras: full detach helper only knows init-tank-boot today — drop boot id path
      if (label === INIT_TANK_BOOT_ID) {
        await detachInitTankBootDisk(vm.connect, vm.name)
        await removeInitTankBootDisk(vm.name)
      }
    }
  }

  for (const [label, d] of Object.entries(disks)) {
    if (present.has(label)) continue
    if (!d.path) die(`workstation reconcile: disk ${label} missing path`)
    // Attach as boot when it is bootDrive (init-tank disposable path).
    if (label === plan.bootDrive || label === INIT_TANK_BOOT_ID) {
      await attachInitTankBootDisk(vm.connect, vm.name, {
        bootDiskPath: d.path,
        seedIsoPath: seedIsoPath?.trim() || undefined,
      })
    } else {
      die(
        `workstation reconcile: attaching non-boot disk ${label} not implemented yet — `
          + `recreate the domain or extend converge`,
      )
    }
  }
}

/**
 * Define domain only (stopped). Disk images must already exist under vm paths.
 * @param {VmContext} ctx
 * @param {VmSpecs} specs
 * @param {AbortSignal} _signal
 * @returns {Promise<WorkstationHandle>}
 */
export async function create(ctx, specs, _signal) {
  await requireBins(['virsh', 'virt-install'])
  const connect = connectOf(ctx)
  const name = String(ctx.name).trim()
  if (await domainExists(connect, name)) {
    die(`workstation create: domain ${name} already exists`)
  }
  if (specs.memory == null || specs.vcpus == null) {
    die('workstation create: memory and vcpus are required')
  }
  const diskLabels = Object.keys(specs.disks || {})
  if (!diskLabels.length) die('workstation create: disks plan is empty')
  for (const label of diskLabels) {
    const d = specs.disks[label]
    if (!d.path || !fs.existsSync(d.path)) {
      die(`workstation create: disk ${label} missing at ${d.path || '(no path)'}`)
    }
  }
  const seed = await ensureSeed({ isoPath: specs.seedIsoPath })
  const ports = portsFromArgv({
    env: ctx.env,
    target: 'workstation',
    profile: ctx.profile,
  })
  const network = specs.network === 'auto' ? 'user' : specs.network || 'user'
  const osinfo = specs.osinfo || 'rocky10'
  const args = buildVirtInstallArgs({
    connect,
    name,
    memory: specs.memory,
    vcpus: specs.vcpus,
    disks: { disks: specs.disks, bootDrive: specs.bootDrive },
    seed,
    ports,
    network,
    osinfo,
  })
  console.log(chalk.cyan(`vm: defining domain ${name} (virt-install --print-xml)…`))
  await defineDomainFromVirtInstallArgs(args)
  console.log(chalk.green(`vm: domain ${name} defined`))
  return { connect, name }
}

/**
 * @param {VmContext} _ctx
 * @param {WorkstationHandle} vm
 * @param {{
 *   serial?: boolean,
 *   classify?: (line: string) => { status: 'ok' | 'fail', line: string } | null,
 * }} [opts]
 * @returns {Promise<SerialFollow | null>}
 */
export async function start(_ctx, vm, opts = {}) {
  const state = await domainState(vm.connect, vm.name)
  if (state === 'running') {
    console.log(chalk.dim(`vm: domain ${vm.name} already running`))
    return null
  }
  if (state !== 'shut off' && state != null) {
    die(`workstation start: domain ${vm.name} is ${state} — expected shut off`)
  }

  /** @type {SerialFollow | null} */
  let follow = null
  if (opts.serial) {
    follow = await startSerialTcpFollow({
      ...(opts.classify ? { classify: opts.classify } : {}),
    })
    const port = follow.port
    if (port == null) die('workstation start: serial follow missing TCP port')
    await setDomainSerialTcp(vm.connect, vm.name, port)
  } else {
    await setDomainSerialNull(vm.connect, vm.name)
  }

  console.log(chalk.cyan(`vm: starting domain ${vm.name}…`))
  const r = await virsh(vm.connect, 'start', vm.name).nothrow()
  if (r.exitCode !== 0) {
    if (follow) await follow.stop()
    die(`virsh start failed: ${String(r.stderr || r.stdout).trim()}`)
  }
  console.log(chalk.green(`vm: domain ${vm.name} started`))
  return follow
}

/**
 * @param {VmContext} _ctx
 * @param {WorkstationHandle} vm
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function stop(_ctx, vm, opts = {}) {
  const state = await domainState(vm.connect, vm.name)
  if (state === 'shut off' || state == null) {
    await setDomainSerialNull(vm.connect, vm.name)
    return
  }
  if (opts.force) {
    await virsh(vm.connect, 'destroy', vm.name)
  } else {
    await virsh(vm.connect, 'shutdown', vm.name)
  }
  await setDomainSerialNull(vm.connect, vm.name)
}

/**
 * Undefine domain (when present) then wipe local disks not in keepDisks.
 * @param {VmContext} ctx
 * @param {VmDestroyOptions} [opts]
 * @returns {Promise<void>}
 */
export async function destroy(ctx, opts = {}) {
  await requireBins(['virsh'])
  const vm = await find(ctx)
  if (vm) await removeDomain(vm.connect, vm.name)
  await wipeLocalDisks(ctx, opts)
}

/**
 * @param {VmContext} ctx
 * @param {VmDestroyOptions} [opts]
 * @returns {Promise<void>}
 */
async function wipeLocalDisks(ctx, opts = {}) {
  const name = String(ctx.name).trim()
  const keep = new Set((opts.keepDisks ?? []).map(String))
  const resolved = await resolveProvisionDisks({
    env: ctx.env || 'dev',
    target: 'workstation',
    profile: ctx.profile,
  })
  const plan = toVmDiskPlan(name, resolved)
  // Include disposable boot path even if not in provision topology.
  /** @type {Record<string, string>} */
  const paths = {
    ...Object.fromEntries(Object.entries(plan.disks).map(([label, d]) => [label, d.path])),
    [INIT_TANK_BOOT_ID]: defaultQcowPath(name, INIT_TANK_BOOT_ID),
  }
  /** @type {string[]} */
  const kept = []
  for (const [label, diskPath] of Object.entries(paths)) {
    if (keep.has(label)) {
      if (fs.existsSync(diskPath)) kept.push(label)
      continue
    }
    if (fs.existsSync(diskPath)) {
      console.log(chalk.yellow(`vm: remove ${diskPath}`))
      await fs.remove(diskPath)
    }
  }
  if (!keep.has(INIT_TANK_BOOT_ID)) await removeInitTankBootDisk(name)
  if (kept.length) {
    console.log(chalk.green(`vm: kept disk label(s): ${kept.join(', ')}`))
  }
}

/**
 * @param {VmContext} _ctx
 * @param {WorkstationHandle} vm
 * @returns {Promise<void>}
 */
export async function detachSeed(_ctx, vm) {
  await detachSeedCdrom(vm.connect, vm.name)
}

/**
 * @param {VmContext} ctx
 * @returns {Promise<VmCheckFacts>}
 */
export async function collectCheckFacts(ctx) {
  const connect = connectOf(ctx)
  /** @type {VmCheckFacts['items']} */
  const items = []
  const ver = await virsh(connect, 'version').nothrow()
  items.push({
    id: 'libvirt',
    ok: ver.exitCode === 0,
    detail:
      ver.exitCode === 0
        ? String(ver.stdout || '')
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l) || 'ok'
        : String(ver.stderr || ver.stdout).trim() || `exit ${ver.exitCode}`,
  })
  const name = String(ctx.name).trim()
  const exists = await domainExists(connect, name)
  items.push({
    id: 'domain',
    ok: exists,
    detail: exists ? `${name} defined` : `${name} absent`,
  })
  return { items }
}
