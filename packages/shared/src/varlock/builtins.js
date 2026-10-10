import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { internal } from 'varlock'

/** @typedef {Awaited<ReturnType<typeof internal.loadEnvGraph>>} EnvGraph */

/**
 * Resolver classes for CLI-only builtins (`varlock`, `keychain`). Cached after first seed load.
 * @type {Promise<{ varlock: unknown, keychain: unknown }> | null}
 */
let builtinResolversPromise = null

/**
 * Capture `varlock()` + `keychain()` from `loadVarlockEnvGraph` (only public registration path).
 * @returns {Promise<{ varlock: unknown, keychain: unknown }>}
 */
function getVarlockBuiltinResolvers() {
  if (!builtinResolversPromise) {
    builtinResolversPromise = (async () => {
      const dir = mkdtempSync(join(tmpdir(), 'qctl-varlock-builtins-'))
      try {
        writeFileSync(join(dir, '.env.schema'), '# ---\n_QCTL_SEED=\n')
        const seed = await internal.loadVarlockEnvGraph({
          entryFilePaths: [dir],
          skipCache: true,
          skipProxyFingerprintGuard: true,
        })
        const varlock = seed.registeredResolverFunctions.varlock
        const keychain = seed.registeredResolverFunctions.keychain
        if (!varlock || !keychain) {
          throw new Error('varlock builtins unavailable (expected varlock() and keychain())')
        }
        return { varlock, keychain }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })()
  }
  return builtinResolversPromise
}

/**
 * Register CLI builtins on a graph loaded via `internal.loadEnvGraph`.
 * @param {EnvGraph} graph
 */
export async function registerVarlockBuiltins(graph) {
  const { varlock, keychain } = await getVarlockBuiltinResolvers()
  if (!('varlock' in graph.registeredResolverFunctions)) {
    graph.registerResolver(/** @type {never} */ (varlock))
  }
  if (!('keychain' in graph.registeredResolverFunctions)) {
    graph.registerResolver(/** @type {never} */ (keychain))
  }
}

/**
 * `internal.loadEnvGraph` plus CLI builtins (`varlock()`, `keychain()`).
 * @param {Parameters<typeof internal.loadEnvGraph>[0]} [opts]
 * @returns {Promise<EnvGraph>}
 */
export async function loadEnvGraph(opts = {}) {
  const userAfterInit = opts.afterInit
  return await internal.loadEnvGraph({
    ...opts,
    afterInit: async (graph) => {
      await registerVarlockBuiltins(graph)
      if (userAfterInit) await userAfterInit(graph)
    },
  })
}
