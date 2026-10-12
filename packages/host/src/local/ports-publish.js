import { passtForwards } from '../lib/ports.js'

/** @import { PortEntry } from '../vm/types.js' */

const SKIP_NAMES = new Set(['ssh', 'cockpit'])

/**
 * Outer `podman run -p` specs from provision networking.ports (minus ssh/cockpit).
 * Host port = `forward`; container port = `dnat ?? forward`.
 * @param {PortEntry[]} ports
 * @returns {{ host: number, container: number, name: string }[]}
 */
export function localPublishPorts(ports) {
  /** @type {{ host: number, container: number, name: string }[]} */
  const out = []
  for (const p of passtForwards(ports)) {
    if (SKIP_NAMES.has(p.name)) continue
    if (p.forward == null) continue
    out.push({
      name: p.name,
      host: p.forward,
      container: p.dnat ?? p.forward,
    })
  }
  return out
}

/**
 * Flat argv fragments: `-p`, `127.0.0.1:host:container`, …
 * @param {PortEntry[]} ports
 * @returns {string[]}
 */
export function localPublishPodmanArgs(ports) {
  /** @type {string[]} */
  const args = []
  for (const p of localPublishPorts(ports)) {
    args.push('-p', `127.0.0.1:${p.host}:${p.container}`)
  }
  return args
}
