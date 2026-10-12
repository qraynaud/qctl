/**
 * Ports from provision/<env>.yaml networking.ports — lab passt + guest DNAT.
 *
 * YAML is a map (normalized to a list with `.name`):
 *
 *   http:
 *     port: 80         # public port on the guest
 *     forward: 8088    # optional passt on hypervisor 127.0.0.1 → guest:port
 *     dnat: 8088       # optional firewalld DNAT guest:port → 127.0.0.1:dnat
 *
 * App Quadlet PublishPort= values come from the app `.env.schema` graph, not from here.
 */
import { die } from './util.js'

/** @import { Argv } from 'yargs' */
/** @import { PortEntry, VmArgv } from '../types.js' */

/**
 * @typedef {{ option: string, argvKey: keyof VmArgv & string }} PortCli
 */

/** CLI flags that override `forward` for a named entry. */
export const PORT_CLI = /** @type {Record<string, PortCli>} */ ({
  ssh: { option: 'ssh-port', argvKey: 'sshPort' },
  cockpit: { option: 'cockpit-port', argvKey: 'cockpitPort' },
  http: { option: 'caddy-http-port', argvKey: 'caddyHttpPort' },
  https: { option: 'caddy-https-port', argvKey: 'caddyHttpsPort' },
})

/**
 * Apply CLI forward overrides (e.g. --ssh-port).
 * @param {PortEntry[]} ports
 * @param {Partial<VmArgv>} [argv]
 * @returns {PortEntry[]}
 */
export function resolvePorts(ports, argv = {}) {
  return ports.map((p) => {
    const cli = PORT_CLI[p.name]
    if (!cli || argv[cli.argvKey] == null || argv[cli.argvKey] === '') return { ...p }
    const forward = Number(argv[cli.argvKey])
    if (!Number.isInteger(forward) || forward < 1 || forward > 65535) {
      die(`--${cli.option} must be 1–65535 (got ${argv[cli.argvKey]})`)
    }
    return { ...p, forward }
  })
}

/**
 * Entries with forward set — passt hostfwd on 127.0.0.1.
 * @param {PortEntry[]} ports
 * @param {Partial<VmArgv>} [argv]
 * @returns {PortEntry[]}
 */
export function passtForwards(ports, argv = {}) {
  return resolvePorts(ports, argv).filter((p) => p.forward != null)
}

/**
 * @param {PortEntry[]} ports
 * @param {Partial<VmArgv>} [argv]
 * @returns {string}
 */
export function passtDesiredFingerprint(ports, argv = {}) {
  return passtForwards(ports, argv)
    .map((p) => `tcp|127.0.0.1|${p.forward}|${p.port}`)
    .sort()
    .join(';')
}

/**
 * @param {PortEntry[]} ports
 * @param {Partial<VmArgv>} [argv]
 * @returns {string}
 */
export function passtForwardsXml(ports, argv = {}) {
  return passtForwards(ports, argv)
    .map((p) =>
      [
        `      <portForward proto='tcp' address='127.0.0.1'>`,
        `        <range start='${p.forward}' to='${p.port}'/>`,
        `      </portForward>`,
      ].join('\n'),
    )
    .join('\n')
}

/**
 * @param {PortEntry[]} ports
 * @param {Partial<VmArgv>} [argv]
 * @returns {string}
 */
export function virtInstallPasstNetworkArg(ports, argv = {}) {
  const parts = ['user,model=virtio,backend.type=passt']
  passtForwards(ports, argv).forEach((p, i) => {
    parts.push(
      `portForward${i}.proto=tcp,portForward${i}.address=127.0.0.1,`
        + `portForward${i}.range0.start=${p.forward},portForward${i}.range0.to=${p.port}`,
    )
  })
  return parts.join(',')
}

/**
 * @param {PortEntry[]} ports
 * @param {Partial<VmArgv>} [argv]
 * @returns {string}
 */
export function passtSummary(ports, argv = {}) {
  return passtForwards(ports, argv)
    .map((p) => `${p.name} :${p.forward}→${p.port}`)
    .join(', ')
}

/**
 * yargs: one --*-port option per entry that has a default forward.
 * @param {Argv} yargs
 * @param {PortEntry[]} ports
 * @returns {Argv}
 */
export function addPasstPortOptions(yargs, ports) {
  let y = yargs
  for (const p of ports) {
    const cli = PORT_CLI[p.name]
    if (!cli || p.forward == null) continue
    const via = p.dnat != null ? `; DNAT → :${p.dnat}` : ''
    y = y.option(cli.option, {
      type: 'number',
      default: p.forward,
      describe: `Lab forward → guest :${p.port}${via} (user/passt; 127.0.0.1)`,
    })
  }
  return y
}

/**
 * @param {PortEntry[]} ports
 * @param {string} name
 * @returns {PortEntry | null}
 */
export function portByName(ports, name) {
  return ports.find((p) => p.name === name) || null
}
