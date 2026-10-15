import { virtInstallPasstNetworkArg } from '../../lib/ports.js'

/** @import { PortsMap } from '../types.js' */
/** @import { VmDiskPaths } from './disks.js' */

/**
 * @param {{
 *   connect: string,
 *   name: string,
 *   memory: number|string,
 *   vcpus: number|string,
 *   disks: VmDiskPaths,
 *   seed: { device: string, path: string, format?: string },
 *   ports: PortsMap,
 *   network: string,
 *   osinfo: string,
 *   serialTcpPort?: number,
 * }} opts
 * @returns {string[]}
 */
export function buildVirtInstallArgs({
  connect,
  name,
  memory,
  vcpus,
  disks,
  seed,
  ports,
  network,
  osinfo,
  /** @type {number | undefined} TCP port we listen on; qemu connects (no PTY). */
  serialTcpPort,
}) {
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
    `path=${disks.os.path},format=qcow2,bus=virtio`,
  ]

  for (const d of disks.attached) {
    const format = d.path.endsWith('.qcow2') ? 'qcow2' : 'raw'
    args.push('--disk', `path=${d.path},format=${format},bus=virtio,serial=${d.id}`)
  }

  if (seed.device === 'cdrom') {
    args.push('--disk', `path=${seed.path},device=cdrom`)
  } else {
    args.push('--disk', `path=${seed.path},format=${seed.format},bus=virtio,serial=cidata`)
  }

  if (network === 'default') {
    args.push('--network', 'network=default,model=virtio')
  } else {
    args.push('--network', virtInstallPasstNetworkArg(ports))
  }

  if (serialTcpPort) {
    // Host listens; qemu connects — no PTY, no root-owned log file.
    // Keep a VGA device even with --graphics none: libvirt -nodefaults +
    // isa-serial alone yields a silent ttyS0; VGA makes serial actually emit.
    args.push(
      '--graphics',
      'none',
      '--video',
      'vga',
      '--serial',
      `tcp,host=127.0.0.1:${serialTcpPort},mode=connect`,
    )
  }

  // Always-on emulated TPM 2.0 (needs host `swtpm`).
  args.push('--tpm', 'backend.type=emulator,backend.version=2.0,model=tpm-crb')

  return args
}
