import { DATA_COUNT, SPECIAL_COUNT } from '../../lib/paths.js'
import { virtInstallPasstNetworkArg } from '../../lib/ports.js'

/** @import { PortEntry, VmArgv } from '../types.js' */
/** @import { VmDiskPaths } from './disks.js' */

/**
 * @param {{
 *   connect: string,
 *   name: string,
 *   memory: number|string,
 *   vcpus: number|string,
 *   disks: VmDiskPaths,
 *   seed: { device: string, path: string, format?: string },
 *   ports: PortEntry[],
 *   argv?: VmArgv | Record<string, unknown>,
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
  /** CLI overrides for ports[].forward */
  argv = {},
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
    `path=${disks.os},format=qcow2,bus=virtio`,
    '--disk',
    `path=${disks.vw},format=qcow2,bus=virtio,serial=rocky-vw`,
  ]

  for (let i = 0; i < DATA_COUNT; i++) {
    args.push('--disk', `path=${disks.data[i]},format=qcow2,bus=virtio,serial=rocky-data${i}`)
  }
  for (let i = 0; i < SPECIAL_COUNT; i++) {
    args.push('--disk', `path=${disks.special[i]},format=qcow2,bus=virtio,serial=rocky-special${i}`)
  }

  if (seed.device === 'cdrom') {
    args.push('--disk', `path=${seed.path},device=cdrom`)
  } else {
    args.push('--disk', `path=${seed.path},format=${seed.format},bus=virtio,serial=cidata`)
  }

  if (network === 'default') {
    args.push('--network', 'network=default,model=virtio')
  } else {
    args.push('--network', virtInstallPasstNetworkArg(ports, argv))
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

  return args
}
