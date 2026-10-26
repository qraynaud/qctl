/**
 * Resolved provision load result (YAML + !env + Zod).
 */
import type { NormalizedPackages } from '@qctl/shared'

import type {
  AlignedVmNic,
  Networking,
  PortsMap,
  ProvisionFile,
  ProxmoxTarget,
  WorkstationTarget,
} from '../provision/schema/types.js'

/** Tier-0 / guest credential bag after provision + optional @tag(guest) merge. */
export type LoadedProvisionGuest = Record<string, string | Buffer | undefined>

export type LoadedProvision = {
  env: string
  target: 'workstation' | 'proxmox'
  /** Provision profile key (`qctl.profiles`). */
  profile: string
  provisionDir: string
  path: string
  paths: string[]
  data: ProvisionFile
  platform: string
  sshAuthorizedKeys: string
  guest: LoadedProvisionGuest
  workstation: WorkstationTarget | null
  proxmox: ProxmoxTarget | null
  /** Ethernet NICs for hypervisor drivers (sorted by label). */
  nets: AlignedVmNic[]
  networking: Networking | null
  ports: PortsMap
  interfaces: Networking['interfaces']
  packages: NormalizedPackages
  files: ProvisionFile['files']
}

export type LoadEnvProvisionOk = { ok: true; provision: LoadedProvision }
export type LoadEnvProvisionErr = { ok: false; error: string }
export type LoadEnvProvisionResult = LoadEnvProvisionOk | LoadEnvProvisionErr
