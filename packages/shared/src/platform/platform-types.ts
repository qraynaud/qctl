/**
 * Platform module types (type-only).
 *
 * Authoring: `./define.js` (`definePackagesMap`, `definePlatform` — no Zod).
 * Guest/host Zod: `./schema.js` (`parsePlatformModule`).
 */

import type { PortsMap } from '../networking/ports-types.ts'
import type { SeedInterfaces } from '../seed/interfaces-types.ts'

export type PlatformCapabilityRecipe = {
  /** Other capability keys in the same map */
  needs?: string[]
  /** Distro package names (dnf/apt/…) */
  distro?: string[]
  pipx?: Array<string | { package: string; inject?: string[] }>
}

/**
 * Capability every platform packages map must include (empty recipe ok).
 * Source of truth: {@link ./required-capabilities.js} `REQUIRED_PLATFORM_CAPABILITIES`.
 */
export type RequiredPlatformCapability =
  import('./required-capabilities.js').RequiredPlatformCapability

/**
 * Open packages map that includes every {@link RequiredPlatformCapability}.
 * Prefer `definePackagesMap` at authoring time so missing keys fail early.
 * When `filesystems` is set, those names are required too (`definePlatform` /
 * guest `parsePlatformModule`).
 */
export type PlatformPackagesMap = Record<RequiredPlatformCapability, PlatformCapabilityRecipe> &
  Record<string, PlatformCapabilityRecipe>

export type PlatformInstallOpts = {
  log?: (line: string) => void
  env?: Record<string, string | undefined>
  /**
   * When true, platform may run a full distro upgrade before installs.
   * Appliance cloud-init does `dnf upgrade` in runcmd instead — do not enable
   * this under a waited `rocky-first-boot` oneshot (systemd upgrade resets D-Bus).
   */
  upgrade?: boolean
}

/**
 * Guest-side networking hooks (OS-specific). Host never imports these —
 * the guest loads the staged platform module and calls them from init stages.
 */
export type PlatformNetworkCtx = {
  log: (line: string) => void
  exec: (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
  /** Ports from ISO seed config (`qctl-seed/config.json`). */
  ports?: PortsMap
  /**
   * Guest interfaces from seed `networking.interfaces` (no `ethernet.vm`).
   * Applied by platform `ensureUp` via NetworkManager — not cloud-init netplan.
   */
  interfaces?: SeedInterfaces
  /** Test override for route_localnet sysctl drop-in path. */
  routeLocalnetConf?: string
}

export type PlatformNetworking = {
  planEnsureUp?: (ctx: PlatformNetworkCtx) => string[]
  ensureUp?: (ctx: PlatformNetworkCtx) => Promise<void>
  planApplyDnat?: (ctx: PlatformNetworkCtx) => string[]
  applyDnat?: (ctx: PlatformNetworkCtx) => Promise<void>
}

/** Default OS disk when provision `disks.os` is omitted/empty. */
export type PlatformOsDisk = {
  /** Serial / by-id; defaults to `"os"` when omitted at resolve time */
  id?: string
  /** Virtual disk size (attach-mode); omit for physical-only default */
  size?: string
}

/**
 * Fully typed platform: `packages` must include every required capability
 * and every `FS` entry.
 *
 * @example
 * ```ts
 * const FILESYSTEMS = ['xfs', 'ext4'] as const
 * type Rocky = Platform<typeof FILESYSTEMS, typeof packages>
 * ```
 */
export type Platform<
  FS extends readonly string[] = readonly string[],
  Pkgs extends Record<FS[number] | RequiredPlatformCapability, PlatformCapabilityRecipe> &
    Record<string, PlatformCapabilityRecipe> = Record<
    FS[number] | RequiredPlatformCapability,
    PlatformCapabilityRecipe
  > &
    Record<string, PlatformCapabilityRecipe>,
> = {
  id: string
  filesystems: FS
  defaultFs: FS[number]
  osDisk: PlatformOsDisk
  packages: Pkgs
  installPackages: (packages: string[], opts?: PlatformInstallOpts) => Promise<void>
  networking?: PlatformNetworking
}

/**
 * Runtime shape of a platform module (matches `z.infer` of
 * `platformModuleSchema` in `./schema.js`). Guest/host parse via
 * `parsePlatformModule`; platforms author via `definePlatform`.
 */
export type PlatformModule = {
  id: string
  packages: PlatformPackagesMap
  installPackages: (packages: string[], opts?: PlatformInstallOpts) => Promise<void>
  networking?: PlatformNetworking
  filesystems?: readonly string[]
  defaultFs?: string
  osDisk?: PlatformOsDisk
}
