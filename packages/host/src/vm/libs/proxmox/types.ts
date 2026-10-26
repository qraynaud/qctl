/**
 * Proxmox API / VM lifecycle types.
 * Provision-shaped fields are derived from Zod schemas (see provision/schema/types).
 * PVE response shapes come from {@link ./api-schemas.js}.
 */
import type { z } from 'zod'

import type { AlignedVmNic, EthernetVm, ProxmoxTarget } from '../../../provision/schema/types.js'

export type { AlignedVmNic, EthernetVm, ProxmoxTarget }

/**
 * Runtime client config from {@link loadProxmoxConfig}.
 * API credentials are load-time required strings; NIC shapes follow `ethernet.vm`.
 */
export type ProxmoxConfig = {
  apiUrl: string
  apiToken: string
  node: string
  storage: string
  imageStorage?: string
  vmid?: NonNullable<ProxmoxTarget['vmid']>
  nets: AlignedVmNic[]
  /** Present on loadProxmoxConfig / tryLoad results (diagnostics). */
  provisionDir?: string
  env?: string
  provisionPath?: string
}

/** Query / form field map (shared so call sites need not index a generic). */
export type ProxmoxRequestFields = Record<string, string | number | boolean | null | undefined>

/**
 * JSON request options — callers must supply `TBody` and `TSoft` (no defaults).
 * `TSoft` selects the return: soft → Zod `safeParse` result, otherwise bare `z.infer<S>`.
 */
export type RequestOpts<TBody, TSoft extends boolean> = {
  query?: ProxmoxRequestFields
  body?: TBody
  form?: ProxmoxRequestFields
  soft?: TSoft
}

/** QEMU config / create form — disk keys are dynamic (`scsiN`, …). */
export type QemuConfig = z.infer<typeof import('./api-schemas.js').pveQemuConfig>

/** serial → volid for persistent (non-OS) disks on a VM/holder. */
export type DiskState = {
  volids: Record<string, string>
  vmid?: number
}

/** One non-OS disk to attach at create/reconcile time. */
export type AttachDiskSpec = {
  id: string
  mode: 'virtual' | 'physical'
  size?: string
  kind: 'data' | 'tank'
  /** Reuse existing volid (holder promote / reconcile). */
  volid?: string | null
}

export type CreateRockyVmOpts = {
  name: string
  memory: number
  vcpus: number
  importVolid: string
  isoVolid: string
  /** OS import size (default 20G). */
  osSize?: string
  /** Non-OS disks in attach order. */
  disks: AttachDiskSpec[]
  /**
   * Desired NICs (sorted by label → netN). Omit → `client.config.nets`.
   */
  nics?: AlignedVmNic[]
  vmid?: number | null
  /** Required persistent serials when promoting a holder. */
  expectedIds?: string[]
}

export type DestroyRockyVmOpts = {
  vmid: number
  name?: string
  keep?: 'none' | 'vw' | 'persistent'
  /** When keep=vw, wipe these tank member serials (leave data volumes). */
  tankIds?: string[]
}

/** Runtime client from `createProxmoxClient` — use JSDoc `ReturnType` in .js consumers. */
