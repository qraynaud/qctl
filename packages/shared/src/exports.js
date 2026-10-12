/** Runtime public API for `@qctl/shared`. Types: see `index.ts`. */

export const QCTL_VERSION = '0.3.0-pre'

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
  loadBootstrapGraph,
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
  ENV_HOST_FILE,
  ENV_HOST_LOCAL_FILE,
  ENV_REF,
  PROVISION_DIR,
  collectEnvRefs,
  envRef,
  hostEnvFilePaths,
  isEnvRef,
  loadHostEnv,
  loadHostEnvDetailed,
  loadHostGuestCredentials,
  loadProvision,
  loadProvisionDocument,
  parseProvisionYaml,
  processEnvWithHostFile,
  provisionEnvDir,
  provisionNeedsEnv,
  readEnvHostFile,
  resolveEnvRefs,
  stripOppositeTarget,
} from './provision.js'
export {
  CONTAINER_REGISTRY_TAG,
  GUEST_TAG,
  collectNpmPluginPins,
  collectNpmPluginPinsFromDir,
  configureNativeHelperEmbed,
  declaresSensitive,
  ensureNpmPluginsFromDir,
  ensureVarlockLocalEncrypt,
  hydrateSystemdCredentials,
  isCompiledQctlBinary,
  isSensitiveItem,
  keysWithTag,
  loadEnvGraph,
  loadEnvGraphForDir,
  prefetchNpmPlugins,
  registerVarlockBuiltins,
  resolveNativeHelperFromNpm,
  resolvedNonSensitive,
  resolvedSensitive,
  sensitiveKeys,
  varlockLocalEncryptName,
} from './varlock-graph.js'
export {
  exitZeroOnMissingCommand,
  isMissingCommandMessage,
  registerCommands,
} from './yargs.js'
