/**
 * Varlock **graph API** helpers (no `varlock` CLI).
 *
 * Load one directory as the graph entry with `currentEnvFallback` so that directory’s
 * `.env.<env>` autoloads (API env flag — schemas do **not** use `# @currentEnv`).
 * `QCTL_ENV` is passed as `overrideValues` for hub `enabled=eq($QCTL_ENV, …)` imports.
 *
 * Callers pass a package root (`applications/<app>/`) for Quadlet template render, or a
 * unit dir (`applications/<app>/<unit>/`) for EnvironmentFile / secrets.
 *
 *   const graph = await loadEnvGraphForDir(pkgOrUnitDir, { qctlEnv: "dev" });
 *   const scope = resolvedNonSensitive(graph, { includeInternal: true });
 *   const secrets = resolvedSensitive(graph);
 *
 * Always registers CLI builtins (`varlock()`, `keychain()`) that raw `internal.loadEnvGraph`
 * omits — required for `varlock(prompt)` / `varlock("local:…")` in provision env files.
 *
 * Third-party `# @plugin` packages resolve from instance `node_modules` (varlock prefers
 * that over plugins-cache). On unresolved-plugin schema errors, qctl reifies
 * `package.json` once via Arborist and reloads.
 */
export { loadEnvGraph, registerVarlockBuiltins } from './builtins.js'
export { hydrateSystemdCredentials } from './hydrate.js'
export { loadEnvGraphForDir } from './load.js'
export {
  configureNativeHelperEmbed,
  ensureVarlockLocalEncrypt,
  isCompiledQctlBinary,
  resolveNativeHelperFromNpm,
  varlockLocalEncryptName,
} from './native-helper.js'
export {
  VARLOCK_UNRESOLVED_PLUGIN_RE,
  ensurePackageDependencies,
  findPackageRoot,
  installPackageDependencies,
  isPackageInstalled,
  isVarlockUnresolvedPluginError,
  packageDepsSatisfied,
  readPackageDependencyMap,
  shouldUseFrozenPackageInstall,
} from './plugins.js'
export {
  keysWithTag,
  resolvedNonSensitive,
  resolvedSensitive,
  sensitiveKeys,
} from './project.js'
export { declaresSensitive, isSensitiveItem } from './sensitivity.js'
export { CONTAINER_REGISTRY_TAG, GUEST_TAG } from './tags.js'
