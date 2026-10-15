/**
 * Resolved provision load result (YAML + !env + Zod).
 */
import type { NormalizedPackages } from '@qctl/shared'

import type {
  AlignedProxmoxNet,
  LocalTarget,
  Networking,
  PortsMap,
  ProvisionFile,
  ProxmoxTarget,
} from '../provision/schema/types.js'

/** Tier-0 / guest credential bag after provision + optional @tag(guest) merge. */
export type LoadedProvisionGuest = Record<string, string | Buffer | undefined>

export type LoadedProvision = {
  env: string
  target: 'local' | 'proxmox'
  provisionDir: string
  path: string
  paths: string[]
  data: ProvisionFile
  platform: string
  sshAuthorizedKeys: string
  guest: LoadedProvisionGuest
  local: LocalTarget | null
  proxmox: ProxmoxTarget | null
  nets: AlignedProxmoxNet[]
  networking: Networking | null
  ports: PortsMap
  uplinks: Networking['uplinks']
  vlans: Networking['vlans']
  packages: NormalizedPackages
  files: ProvisionFile['files']
}

export type LoadEnvProvisionOk = { ok: true; provision: LoadedProvision }
export type LoadEnvProvisionErr = { ok: false; error: string }
export type LoadEnvProvisionResult = LoadEnvProvisionOk | LoadEnvProvisionErr
