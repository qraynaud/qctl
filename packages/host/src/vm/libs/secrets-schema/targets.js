import { z } from 'zod'

import { proxmoxNetMapSchema } from './networking.js'

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
    api_url: z.string().optional(),
    api_token: z.string().optional(),
    node: z.string().optional(),
    storage: z.string().optional(),
    image_storage: z.string().optional(),
    vmid: z.coerce.number().int().optional(),
    net: proxmoxNetMapSchema.optional(),
    ...vmResourcesFields,
  })
  .passthrough()
