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
 * omits — required for `varlock(prompt)` / `varlock("local:…")` in `.env.host` etc.
 */
export * from './varlock/index.js'
