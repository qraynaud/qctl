/** Runtime public API for `@qctl/shared`. Types: see `index.ts`. */

export const QCTL_VERSION = '0.4.0'

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
export { findInstanceRoot, hasQctlProvision, isInstanceRoot } from './instance.js'
export { deepMerge } from './merge.js'
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
  definePlatform,
  distroPackagesForCapabilities,
  expandCapabilities,
  installCapabilityPackages,
  packagesForCapabilities,
  platformCapabilityRecipeSchema,
  platformModuleSchema,
  platformPackagesMapSchema,
} from './platform/index.js'
export {
  ENV_REF,
  PROVISION_DIR,
  collectEnvRefs,
  envRef,
  isEnvRef,
  loadHostEnv,
  loadHostEnvDetailed,
  loadHostGuestCredentials,
  loadProvision,
  loadProvisionDocument,
  parseProvisionYaml,
  provisionEnvDir,
  provisionNeedsEnv,
  resolveEnvRefs,
  stripOppositeTarget,
} from './provision/index.js'
export {
  CONTAINER_REGISTRY_TAG,
  GUEST_TAG,
  collectNpmPluginPins,
  collectNpmPluginPinsFromDir,
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
  keysWithTag,
  loadEnvGraph,
  loadEnvGraphForDir,
  packageDepsSatisfied,
  parseNpmPluginDescriptor,
  parseNpmPluginRef,
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
