/**
 * Zod schemas for Proxmox API `data` payloads.
 */
import { z } from 'zod'

/** When the response body is unused (PUT/DELETE side effects). */
export const pveUnknown = z.unknown()

/** Task / action UPID string (or null when PVE has nothing to wait on). */
export const pveUpid = z.string().nullish()

export const pveVersion = z.object({
  version: z.string(),
})

export const pveNextId = z.union([z.string(), z.number()])

export const pveTaskStatus = z.object({
  status: z.string(),
  exitstatus: z.string().optional(),
})

export const pveQemuListEntry = z.object({
  vmid: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  status: z.string().optional(),
})

export const pveQemuList = z.array(pveQemuListEntry)

/** QEMU config / create form — disk keys are dynamic (`scsiN`, …). */
export const pveQemuConfig = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
)

export const pveQemuStatus = z.object({
  status: z.string(),
  uptime: z.number().optional(),
  cpus: z.number().optional(),
  maxmem: z.number().optional(),
})

export const pveStorage = z.object({
  content: z.string().optional(),
  digest: z.string().optional(),
})

export const pveStorageContent = z.array(
  z.object({
    volid: z.string().optional(),
  }),
)

/** Cluster node list (`GET /nodes`). */
export const pveNodeList = z.array(
  z.object({
    node: z.string().optional(),
    status: z.string().optional(),
  }),
)

/** Per-node storage list (`GET /nodes/:node/storage`). */
export const pveNodeStorageList = z.array(
  z.object({
    storage: z.string().optional(),
    content: z.union([z.string(), z.array(z.string())]).optional(),
    active: z.number().optional(),
    enabled: z.number().optional(),
  }),
)

/** Host network list (`GET /nodes/:node/network`). */
export const pveNetworkList = z.array(
  z.object({
    iface: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
  }),
)
