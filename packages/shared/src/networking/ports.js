/**
 * Named ports map (provision `networking.ports` / ISO seed config).
 * Shared by host seed tree and guest DNAT apply.
 */
import { z } from 'zod'

/** @import { DnatEntry, PortsDnatSource } from './ports-types.js' */

const portNum = z.number().int().min(1).max(65535)

/** App / extra named port (no built-in defaults). */
export const portEntrySchema = z.strictObject({
  port: portNum,
  forward: portNum.optional(),
  dnat: portNum.optional(),
})

/** Lab SSH — always present after parse; omit entry → default forward. */
const sshPortSchema = z
  .strictObject({
    port: portNum.default(22),
    forward: portNum.optional(),
    dnat: portNum.optional(),
  })
  .prefault({ forward: 2222 })

/** Cockpit — always present after parse; omit entry → default forward. */
const cockpitPortSchema = z
  .strictObject({
    port: portNum.default(9090),
    forward: portNum.optional(),
    dnat: portNum.optional(),
  })
  .prefault({ forward: 9090 })

/**
 * Named ports map. `ssh` + `cockpit` always present (field defaults + prefault);
 * other names via catchall (open map of {@link portEntrySchema}).
 */
export const portsSchema = z
  .strictObject({
    ssh: sshPortSchema,
    cockpit: cockpitPortSchema,
  })
  .catchall(portEntrySchema)
  .prefault({})

/**
 * Entries with numeric `dnat` (guest firewalld forward → 127.0.0.1).
 * @param {PortsDnatSource | null | undefined} ports
 * @returns {DnatEntry[]}
 */
export function dnatEntriesFromPorts(ports) {
  if (!ports || typeof ports !== 'object') return []
  /** @type {DnatEntry[]} */
  const out = []
  for (const [name, entry] of Object.entries(ports)) {
    if (!entry || typeof entry !== 'object') continue
    const { port, dnat } = entry
    if (typeof port !== 'number' || typeof dnat !== 'number') continue
    out.push({ name, port, dnat })
  }
  return out
}
