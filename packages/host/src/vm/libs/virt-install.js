import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { $ } from 'zx'

import { die } from '../../lib/util.js'
import { virsh } from './libvirt/virsh.js'
import { nicsSorted } from './nic-plan.js'
import { injectInterfaceAliases, virtInstallNetworkArgv } from './virt-install-net.js'

/** @import { VmNicsSpec, VmSpecs } from '../driver-contract.js' */
/** @import { PortsMap } from '../types.js' */

/**
 * @param {{
 *   connect: string,
 *   name: string,
 *   memory: number|string,
 *   vcpus: number|string,
 *   disks: Pick<VmSpecs, 'disks' | 'bootDrive'>,
 *   seed: { device: string, path: string, format?: string },
 *   ports: PortsMap,
 *   osinfo: string,
 *   serialTcpPort?: number,
 *   nics?: VmNicsSpec | null,
 * }} opts
 * @returns {string[]}
 */
export function buildVirtInstallArgs({
  connect,
  name,
  memory,
  vcpus,
  disks: plan,
  seed,
  ports,
  osinfo,
  serialTcpPort,
  nics,
}) {
  const labels = Object.keys(plan?.disks || {})
  if (!labels.length) die('buildVirtInstallArgs: disks is empty')
  const bootLabel = plan.bootDrive || labels[0]
  const boot = plan.disks[bootLabel]
  if (!boot?.path) die(`buildVirtInstallArgs: boot disk ${bootLabel} missing path`)
  const format = boot.format || (boot.path.endsWith('.qcow2') ? 'qcow2' : 'raw')
  const rootDisk = `path=${boot.path},format=${format},bus=virtio,serial=${bootLabel},boot.order=1`

  /** @type {string[]} */
  const args = [
    'virt-install',
    '--connect',
    connect,
    '--name',
    name,
    '--memory',
    String(memory),
    '--vcpus',
    `${vcpus},sockets=1,cores=${vcpus},threads=1`,
    '--cpu',
    'host-passthrough',
    '--import',
    '--osinfo',
    osinfo,
    '--noautoconsole',
    '--wait',
    '0',
    '--disk',
    rootDisk,
  ]

  for (const [label, d] of Object.entries(plan.disks)) {
    if (label === bootLabel) continue
    if (!d.path) die(`buildVirtInstallArgs: disk ${label} missing path`)
    const fmt = d.format || (d.path.endsWith('.qcow2') ? 'qcow2' : 'raw')
    args.push('--disk', `path=${d.path},format=${fmt},bus=virtio,serial=${label}`)
  }

  if (seed.device === 'cdrom') {
    args.push('--disk', `path=${seed.path},device=cdrom`)
  } else {
    args.push('--disk', `path=${seed.path},format=${seed.format},bus=virtio,serial=cidata`)
  }

  args.push(...virtInstallNetworkArgv({ nics, ports }))

  if (serialTcpPort) {
    args.push(
      '--graphics',
      'none',
      '--video',
      'vga',
      '--serial',
      `tcp,host=127.0.0.1:${serialTcpPort},mode=connect`,
    )
  }

  args.push('--tpm', 'backend.type=emulator,backend.version=2.0,model=tpm-crb')

  return args
}

/**
 * Define a domain from virt-install args without starting it (`--print-xml` + `virsh define`).
 * @param {string[]} args from {@link buildVirtInstallArgs}
 * @param {{ nics?: VmNicsSpec | null }} [opts]  inject libvirt `<alias>` for plan labels
 * @returns {Promise<void>}
 */
export async function defineDomainFromVirtInstallArgs(args, opts = {}) {
  const connectIdx = args.indexOf('--connect')
  const nameIdx = args.indexOf('--name')
  if (connectIdx < 0 || nameIdx < 0) {
    die('defineDomainFromVirtInstallArgs: missing --connect/--name in virt-install args')
  }
  const connect = args[connectIdx + 1]
  const name = args[nameIdx + 1]
  const printArgs = [...args, '--print-xml']
  const r = await $`${printArgs}`.nothrow()
  if (r.exitCode !== 0) {
    console.error(String(r.stderr || r.stdout))
    die(`virt-install --print-xml failed (exit ${r.exitCode})`)
  }
  let xml = String(r.stdout || '').trim()
  if (!xml.includes('<domain')) {
    die('virt-install --print-xml produced no domain XML')
  }
  const labels = nicsSorted(opts.nics).map(([label]) => label)
  if (labels.length) xml = injectInterfaceAliases(xml, labels)
  const tmp = path.join(os.tmpdir(), `rocky-${name}-define.xml`)
  fs.writeFileSync(tmp, xml, 'utf8')
  try {
    const def = await virsh(connect, 'define', tmp).nothrow()
    if (def.exitCode !== 0) {
      die(`virsh define ${name} failed: ${String(def.stderr || def.stdout).trim()}`)
    }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}
