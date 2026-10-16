/** Runtime public API for `@qctl/shared`. Types: see `index.ts`. */

export const QCTL_VERSION = '0.6.0-pre'

/**
 * @param {never} value
 * @param {string} [message]
 * @returns {never}
 */
export function assertNever(value, message) {
  throw new Error(message ?? `unexpected value: ${String(value)}`)
}

export {
  BOOTSTRAP_DIR_DEFAULT,
  BOOTSTRAP_INSTANCE_DIR,
  instanceBootstrapDir,
  resolveBootstrapDir,
} from './bootstrap.js'
export {
  DEFAULT_TANK_OPTIONS,
  DISK_VDEV_MIN_MEMBERS,
  DISK_VDEV_ROLES,
  DISK_VDEV_TYPES,
} from './disks/constants.js'
export {
  disksJsonDataVolumeSchema,
  disksJsonMemberSchema,
  disksJsonOsSchema,
  disksJsonSchema,
  disksJsonTankMemberSchema,
  disksJsonTankSchema,
  disksJsonVdevSchema,
  disksPackageHints,
} from './disks/disks-json.js'
export { tankOptionsSchema } from './disks/tank-options.js'
export { tankPassphraseCredName } from './disks/tank-passphrase.js'
export {
  VDEV_ROLE_REGISTRY,
  vdevGeometryArgv,
  vdevRoleArgv,
  vdevTypeGeometry,
  zfsAcltype,
} from './disks/vdev-registry.js'
export { buildZpoolCreateArgv } from './disks/zpool-create.js'
export { findInstanceRoot, hasQctlProvision, isInstanceRoot } from './instance.js'
export { deepMerge, isYamlMapping } from './merge.js'
export { dnatEntriesFromPorts, portEntrySchema, portsSchema } from './networking/ports.js'
export {
  emptyPackages,
  mergePackages,
  normalizePackages,
  packagesHttpItemSchema,
  packagesIsEmpty,
  packagesManifestSchema,
  packagesPipxItemSchema,
} from './packages/manifest.js'
export { MERCURIAL_PIPX_DEFAULT } from './packages/mercurial.js'
export {
  definePackagesMap,
  definePlatform,
  distroPackagesForCapabilities,
  expandCapabilities,
  installCapabilityPackages,
  packagesForCapabilities,
  packagesMapWithRequired,
  parsePlatformModule,
  platformCapabilityRecipeSchema,
  platformModuleSchema,
  platformModuleSchemaFor,
  platformPackagesMapSchema,
  platformPackagesMapSchemaFor,
  requiredPlatformCapabilitySchema,
} from './platform/index.js'
export {
  BUILTIN_ENVIRONMENTS,
  BUILTIN_PROFILES,
  COMMON_PROVISION,
  ENV_REF,
  PROVISION_DIR,
  PROVISION_TARGETS,
  collectEnvRefs,
  enrichQctlHostMetaFields,
  envRef,
  environmentSpecSchema,
  isEmptyCredential,
  isEnvRef,
  isProductionEnv,
  isReservedProvisionName,
  loadHostEnv,
  loadHostEnvDetailed,
  loadHostGuestCredentials,
  loadProvision,
  loadProvisionDocument,
  loadQctlHostMeta,
  parseProvisionYaml,
  profileSpecSchema,
  provisionEnvDir,
  provisionLayerNameSchema,
  provisionNeedsEnv,
  qctlHostMetaFieldsSchema,
  qctlHostMetaSchema,
  refineQctlHostMeta,
  resolveEnvRefs,
  resolveProfile,
  stripOppositeTarget,
} from './provision/index.js'
export {
  CONTAINER_REGISTRY_TAG,
  GUEST_TAG,
  VARLOCK_UNRESOLVED_PLUGIN_RE,
  configureNativeHelperEmbed,
  declaresSensitive,
  ensurePackageDependencies,
  ensureVarlockLocalEncrypt,
  findPackageRoot,
  hydrateSystemdCredentials,
  installPackageDependencies,
  isCompiledQctlBinary,
  isPackageInstalled,
  isSensitiveItem,
  isVarlockUnresolvedPluginError,
  keysWithTag,
  loadEnvGraph,
  loadEnvGraphForDir,
  packageDepsSatisfied,
  readPackageDependencyMap,
  registerVarlockBuiltins,
  resolveNativeHelperFromNpm,
  resolvedNonSensitive,
  resolvedSensitive,
  sensitiveKeys,
  shouldUseFrozenPackageInstall,
  varlockLocalEncryptName,
} from './varlock/index.js'
export {
  exitZeroOnMissingCommand,
  isMissingCommandMessage,
  registerCommands,
} from './yargs.js'
