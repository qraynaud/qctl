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
  collectNpmPluginPins,
  collectNpmPluginPinsFromDir,
  ensureNpmPluginsFromDir,
  prefetchNpmPlugins,
} from './plugins.js'
export {
  keysWithTag,
  resolvedNonSensitive,
  resolvedSensitive,
  sensitiveKeys,
} from './project.js'
export { declaresSensitive, isSensitiveItem } from './sensitivity.js'
export { CONTAINER_REGISTRY_TAG, GUEST_TAG } from './tags.js'
