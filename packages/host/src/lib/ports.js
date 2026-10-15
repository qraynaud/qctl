/**
 * Ports from provision/<env>.yaml networking.ports — lab passt + guest DNAT.
 *
 * YAML / parsed shape is a map keyed by name:
 *
 *   http:
 *     port: 80         # public port on the guest
 *     forward: 8088    # optional passt on hypervisor 127.0.0.1 → guest:port
 *     dnat: 8088       # optional firewalld DNAT guest:port → 127.0.0.1:dnat
 *
 * App Quadlet PublishPort= values come from the app `.env.schema` graph, not from here.
 * Lab hostfwd values are provision-only (no CLI overrides).
 */
import { die } from './util.js'

/** @import { PortEntry, PortsMap } from '../vm/types.js' */

/**
 * Entries with forward set — passt hostfwd on 127.0.0.1.
 * @param {PortsMap} ports
 * @returns {[string, PortEntry][]}
 */
export function passtForwards(ports) {
  return Object.entries(ports).filter(([, p]) => p.forward != null)
}

/**
 * @param {PortsMap} ports
 * @returns {string}
 */
export function passtDesiredFingerprint(ports) {
  return passtForwards(ports)
    .map(([, p]) => `tcp|127.0.0.1|${p.forward}|${p.port}`)
    .sort()
    .join(';')
}

/**
 * @param {PortsMap} ports
 * @returns {string}
 */
export function passtForwardsXml(ports) {
  return passtForwards(ports)
    .map(([, p]) =>
      [
        `      <portForward proto='tcp' address='127.0.0.1'>`,
        `        <range start='${p.forward}' to='${p.port}'/>`,
        `      </portForward>`,
      ].join('\n'),
    )
    .join('\n')
}

/**
 * @param {PortsMap} ports
 * @returns {string}
 */
export function virtInstallPasstNetworkArg(ports) {
  const parts = ['user,model=virtio,backend.type=passt']
  passtForwards(ports).forEach(([, p], i) => {
    parts.push(
      `portForward${i}.proto=tcp,portForward${i}.address=127.0.0.1,`
        + `portForward${i}.range0.start=${p.forward},portForward${i}.range0.to=${p.port}`,
    )
  })
  return parts.join(',')
}

/**
 * @param {PortsMap} ports
 * @returns {string}
 */
export function passtSummary(ports) {
  return passtForwards(ports)
    .map(([name, p]) => `${name} :${p.forward}→${p.port}`)
    .join(', ')
}

/**
 * Required named port (throws if absent).
 * @param {PortsMap} ports
 * @param {string} name
 * @returns {PortEntry}
 */
export function portByName(ports, name) {
  const p = ports[name]
  if (!p) die(`networking.ports.${name}: missing`)
  return p
}
