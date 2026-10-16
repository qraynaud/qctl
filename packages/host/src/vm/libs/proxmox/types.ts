/**
 * Proxmox API / VM lifecycle types.
 * Provision-shaped fields are derived from Zod schemas (see provision/schema/types).
 */
import type {
  AlignedProxmoxNet,
  ProxmoxNetEntry,
  ProxmoxTarget,
} from '../../../provision/schema/types.js'

export type { AlignedProxmoxNet, ProxmoxNetEntry, ProxmoxTarget }

/** Provision net entry (aligned rows may include uplink `name`). */
export type ProxmoxNet = ProxmoxNetEntry & { name?: string }

/**
 * Runtime client config from {@link loadProxmoxConfig}.
 * API credentials are load-time required strings; NIC / vmid shapes follow provision schemas.
 */
export type ProxmoxConfig = {
  apiUrl: string
  apiToken: string
  node: string
  storage: string
  imageStorage?: string
  vmid?: NonNullable<ProxmoxTarget['vmid']>
  nets: AlignedProxmoxNet[]
  /** Present on loadProxmoxConfig / tryLoad results (diagnostics). */
  provisionDir?: string
  env?: string
  provisionPath?: string
  bridge?: ProxmoxNetEntry['bridge']
  vlan?: NonNullable<ProxmoxNetEntry['vlan']>
  trunks?: NonNullable<ProxmoxNetEntry['trunks']>
  mac?: NonNullable<ProxmoxNetEntry['mac']>
}

export type RequestOpts = {
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  form?: Record<string, string | number | boolean | null | undefined>
  soft?: boolean
}

export type SoftResult = { ok: true; data: unknown } | { ok: false; error: string }

/** QEMU config / create form — disk keys are dynamic (`scsiN`, …). */
export type QemuConfig = Record<string, string | number | boolean | undefined | null>

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

export type QemuListEntry = {
  vmid: number | string
  name?: string
  status?: string
}

/** Runtime client from `createProxmoxClient` — use JSDoc `ReturnType` in .js consumers. */
