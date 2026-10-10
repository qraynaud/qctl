/**
 * Proxmox API / VM lifecycle types.
 */

export type ProxmoxNet = {
  bridge: string
  model?: string
  vlan?: number | null
  trunks?: number[] | null
  mac?: string | null
  firewall?: boolean | number | string | null
  tag?: number | null
}

export type ProxmoxConfig = {
  apiUrl: string
  apiToken: string
  node: string
  storage: string
  imageStorage?: string
  vmid?: number | null
  nets: ProxmoxNet[]
  /** Present on loadProxmoxConfig / tryLoad results (diagnostics). */
  provisionDir?: string
  env?: string
  secretsPath?: string
  bridge?: string
  vlan?: number | null
  trunks?: number[] | null
  mac?: string | null
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

export type DiskState = {
  vw: string | null
  data: (string | null)[]
  special: (string | null)[]
  vmid?: number
}

export type CreateRockyVmOpts = {
  name: string
  memory: number
  vcpus: number
  vwSize: string
  dataSize: string
  specialSize: string
  importVolid: string
  isoVolid: string
  vwVolid?: string | null
  dataVolids?: (string | null)[] | null
  specialVolids?: (string | null)[] | null
  vmid?: number | null
}

export type DestroyRockyVmOpts = {
  vmid: number
  name?: string
  keep?: 'none' | 'vw' | 'persistent'
}

export type QemuListEntry = {
  vmid: number | string
  name?: string
  status?: string
}

/** Runtime client from `createProxmoxClient` — use JSDoc `ReturnType` in .js consumers. */
