/**
 * Resolve SSH endpoint for `qctl sync` from --env / --target (+ overrides).
 */
import { chalk } from 'zx'

import { portsFromArgv } from '../lib/options.js'
import { portByName } from '../lib/ports.js'
import { resolveVmName } from '../lib/target.js'
import { virsh } from '../vm/libs/libvirt/index.js'

/** @import { VmArgv } from '../vm/types.js' */

/**
 * @typedef {object} SyncEndpoint
 * @property {string} host
 * @property {number} port
 * @property {string} username
 * @property {string} remoteDir
 * @property {string} [identity]
 * @property {string} label human-readable summary
 */

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
 * @param {VmArgv & {
 *   user?: string
 *   host?: string
 *   port?: number
 *   remoteDir?: string
 *   identity?: string
 * }} argv
 * @returns {Promise<SyncEndpoint>}
 */
export async function resolveSyncEndpoint(argv) {
  const name = resolveVmName(argv)
  argv.name = name
  const username = (argv.user || 'rocky').trim() || 'rocky'
  const remoteDir = (argv.remoteDir || '/tank/rocky').trim() || '/tank/rocky'
  const identity = argv.identity?.trim() || undefined
  const target = argv.target || 'local'
  const network = argv.network === 'auto' ? 'user' : argv.network || 'user'

  if (argv.host?.trim()) {
    const host = argv.host.trim()
    const port = argv.port != null ? Number(argv.port) : 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`--port must be 1–65535 (got ${argv.port})`)
    }
    return {
      host,
      port,
      username,
      remoteDir,
      identity,
      label: `${username}@${host}:${port} (${target}/${argv.env || 'dev'}) → ${remoteDir}`,
    }
  }

  if (target === 'proxmox') {
    throw new Error(
      '--target proxmox needs --host <guest-ip> (and optional --port).\n'
        + '  Tip: qctl vm ssh-info --target proxmox',
    )
  }

  // local libvirt
  if (network === 'default') {
    const ip = await localLeaseIp(argv.connect || 'qemu:///system', name)
    if (!ip) {
      throw new Error(
        `no DHCP lease for ${name} yet (network=default).\n`
          + `  Wait for boot, or use --network user / --host.`,
      )
    }
    const port = argv.port != null ? Number(argv.port) : 22
    return {
      host: ip,
      port,
      username,
      remoteDir,
      identity,
      label: `${username}@${ip}:${port} (local/default) → ${remoteDir}`,
    }
  }

  const ports = portsFromArgv(argv)
  const forward = portByName(ports, 'ssh').forward
  if (forward == null) {
    throw new Error(
      'no ssh.forward in provision networking.ports (passt).\n'
        + '  Set networking.ports.ssh.forward, or pass --host / --port.',
    )
  }
  const port = argv.port != null ? Number(argv.port) : forward
  return {
    host: '127.0.0.1',
    port,
    username,
    remoteDir,
    identity,
    label: `${username}@127.0.0.1:${port} (local/user) → ${remoteDir}`,
  }
}

/**
 * @param {SyncEndpoint} ep
 */
export function logEndpoint(ep) {
  console.log(chalk.cyan('sync'), chalk.dim(ep.label))
}
