/**
 * Secret admin/apps RPC: `{ [O in ops]: (params) => Promise<Answer> }`.
 */
import { runSecretCheck } from '../../secret/check.js'
import { runSecretSync } from '../../secret/sync.js'

/** @import { OsConfig } from '@qctl/shared' */
/** @import { SecretParams } from '../protocol.js' */

/**
 * @template {SecretParams['op']} O
 * @typedef {Extract<SecretParams, { op: O }>} SecretOpParams
 */

/**
 * @typedef {{ exitCode: number, error?: string }} SecretOpAnswer
 */

/**
 * @typedef {{
 *   [O in SecretParams['op']]: (
 *     params: SecretOpParams<O>,
 *   ) => Promise<SecretOpAnswer>
 * }} SecretOps
 */

/** @returns {SecretOpAnswer} */
function ok() {
  return { exitCode: 0 }
}

/**
 * @param {{
 *   root: string,
 *   osConfig?: OsConfig | null,
 *   rootlessOnly?: boolean,
 *   log?: (msg: string) => void,
 * }} ctx
 * @returns {SecretOps}
 */
export function createSecretOps(ctx) {
  const log = ctx.log ?? (() => {})
  const quadletUser = ctx.osConfig?.quadletUser
  return {
    async sync(params) {
      await runSecretSync({
        root: ctx.root,
        app: params.app,
        dryRun: Boolean(params.dryRun),
        restart: Boolean(params.restart),
        rootlessOnly: Boolean(ctx.rootlessOnly),
        qctlEnv: params.env,
        quadletUser,
        uid: 0,
        log,
      })
      return ok()
    },
    async check(params) {
      const result = await runSecretCheck({
        root: ctx.root,
        app: params.app,
        rootlessOnly: Boolean(ctx.rootlessOnly),
        qctlEnv: params.env,
        quadletUser,
        uid: 0,
        log,
      })
      return { exitCode: result.ok ? 0 : 1 }
    },
  }
}

/**
 * @param {SecretOps} ops
 * @param {SecretParams} params
 * @returns {Promise<SecretOpAnswer>}
 */
export async function invokeSecretOp(ops, params) {
  try {
    return await /** @type {(p: typeof params) => Promise<SecretOpAnswer>} */ (ops[params.op])(
      params,
    )
  } catch (e) {
    return {
      exitCode: 1,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
