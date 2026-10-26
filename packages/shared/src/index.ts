// Runtime surface: src/exports.js. Add public `export type` here when needed.

export type { DisksJson, DisksPackageHints } from './disks/disks-json-types.ts'
export type { TankOptions, TankOptionsInput } from './disks/tank-options-types.ts'
export * from './exports.js'
export type {
  DnatEntry,
  PortEntry,
  PortsDnatSource,
  PortsMap,
} from './networking/ports-types.ts'
export type { NormalizedPackages } from './packages/manifest.js'
export type {
  Platform,
  PlatformCapabilityRecipe,
  PlatformInstallOpts,
  PlatformModule,
  PlatformNetworkCtx,
  PlatformNetworking,
  PlatformOsDisk,
  PlatformPackagesMap,
  RequiredPlatformCapability,
} from './platform/platform-types.ts'
export type {
  InitProfile,
  PlatformStage,
  PlatformStageContext,
  QctlRole,
} from './roles.js'
export type {
  OsConfig,
  SeedAdminUser,
  SeedAppsUser,
  SeedConfig,
  SeedInitTank,
  SeedProfile,
  SeedRepo,
  SeedSubidRange,
} from './seed/config-types.ts'
export type {
  SeedInterfaceDummy,
  SeedInterfaceEntry,
  SeedInterfaceEthernet,
  SeedInterfaceVlan,
  SeedInterfaces,
} from './seed/interfaces-types.ts'
export type { YamlMapping, YamlValue } from './yaml.js'
