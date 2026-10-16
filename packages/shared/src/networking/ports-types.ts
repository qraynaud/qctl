import type { z } from 'zod'

import type { portEntrySchema, portsSchema } from './ports.js'

export type PortEntry = z.infer<typeof portEntrySchema>
export type PortsMap = z.infer<typeof portsSchema>

/**
 * Ports map shape for DNAT extraction (schema output or partial JSON).
 * Does not require ssh/cockpit defaults.
 */
export type PortsDnatSource = Record<string, { port: number; forward?: number; dnat?: number }>

/** One firewalld DNAT forward derived from a ports map entry with `dnat`. */
export type DnatEntry = {
  name: string
  port: number
  dnat: number
}
