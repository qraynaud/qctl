import { z } from 'zod'

import { proxmoxNetMapSchema } from './networking.js'
import { optionalTrimmedText } from './zod-utils.js'

/** vCPU count (maps to CLI --vcpus / virt-install --vcpus / PVE cores). */
export const cpuSchema = z.coerce.number().int().min(1).max(256)

/** RAM in MiB (maps to CLI --memory / virt-install --memory / PVE memory). */
export const memorySchema = z.coerce.number().int().min(256).max(1048576)

const vmResourcesFields = {
  cpu: cpuSchema.optional(),
  memory: memorySchema.optional(),
}

/** Local libvirt VM sizing (and future local-only knobs). */
export const localSchema = z.object(vmResourcesFields).passthrough()

export const proxmoxSchema = z
  .object({
    api_url: optionalTrimmedText.optional(),
    api_token: optionalTrimmedText.optional(),
    node: optionalTrimmedText.optional(),
    storage: optionalTrimmedText.optional(),
    image_storage: optionalTrimmedText.optional(),
    vmid: z.coerce.number().int().optional(),
    net: proxmoxNetMapSchema.optional(),
    ...vmResourcesFields,
  })
  .passthrough()
