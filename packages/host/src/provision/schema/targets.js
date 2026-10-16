import { z } from 'zod'

import { proxmoxNetMapSchema } from './networking.js'
import { optionalTrimmedText } from './zod-utils.js'

/** vCPU count (maps to CLI --vcpus / virt-install --vcpus / PVE cores). */
export const cpuSchema = z.number().int().min(1).max(256)

/** RAM in MiB (maps to CLI --memory / virt-install --memory / PVE memory). */
export const memorySchema = z.number().int().min(256).max(1048576)

/** Local libvirt VM sizing. */
export const localSchema = z.strictObject({
  cpu: cpuSchema.optional(),
  memory: memorySchema.optional(),
})

/** Proxmox target. */
export const proxmoxSchema = localSchema.extend({
  api_url: optionalTrimmedText,
  api_token: optionalTrimmedText,
  node: optionalTrimmedText,
  storage: optionalTrimmedText,
  image_storage: optionalTrimmedText,
  vmid: z.number().int().min(100).optional(),
  net: proxmoxNetMapSchema.optional(),
})
