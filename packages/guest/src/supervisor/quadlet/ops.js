/**
 * Quadlet admin RPC: `{ [O in ops]: (params: OpParams<O>) => Promise<Answer<O>> }`.
 */

import { runEnable } from './enable.js'
import { QuadletError } from './errors.js'
import { runDown, runPs, runRestart, runStartStop } from './lifecycle.js'
import { runUp } from './up/index.js'

/** @import { QuadletParams } from '../protocol.js' */
/** @import { QuadletContext } from './context.js' */

/**
 * @template {QuadletParams['op']} O
 * @typedef {Extract<QuadletParams, { op: O }>} QuadletOpParams
 */

/**
 * @typedef {{ exitCode: number, error?: string }} QuadletOpAnswer
 */

/**
 * @typedef {{
 *   [O in QuadletParams['op']]: (
 *     params: QuadletOpParams<O>,
 *   ) => Promise<QuadletOpAnswer>
 * }} QuadletOps
 */

/** @returns {QuadletOpAnswer} */
function ok() {
  return { exitCode: 0 }
}

/**
 * Bind libraries to a request context.
 * @param {QuadletContext} ctx
 * @returns {QuadletOps}
 */
export function createQuadletOps(ctx) {
  return {
    async up(params) {
      await runUp(ctx, {
        dryRun: Boolean(params.dryRun),
        apps: params.apps?.length ? params.apps : undefined,
      })
      return ok()
    },
    async down(params) {
      for (const app of params.apps) await runDown(ctx, app)
      return ok()
    },
    async enable(params) {
      for (const app of params.apps) {
        await runEnable(ctx, { app, install: params.install !== false })
      }
      return ok()
    },
    async start(params) {
      for (const app of params.apps) await runStartStop(ctx, 'start', app)
      return ok()
    },
    async stop(params) {
      for (const app of params.apps) await runStartStop(ctx, 'stop', app)
      return ok()
    },
    async restart(params) {
      for (const app of params.apps) await runRestart(ctx, app)
      return ok()
    },
    async ps(params) {
      await runPs(ctx, params.apps?.length ? params.apps : undefined)
      return ok()
    },
  }
}

/**
 * Correlated call: `ops[params.op](params)` (one cast). Maps QuadletError → exitCode 1.
 * @param {QuadletOps} ops
 * @param {QuadletParams} params
 * @returns {Promise<QuadletOpAnswer>}
 */
export async function invokeQuadletOp(ops, params) {
  try {
    return await /** @type {(p: typeof params) => Promise<QuadletOpAnswer>} */ (ops[params.op])(
      params,
    )
  } catch (e) {
    if (e instanceof QuadletError) {
      return { exitCode: 1, error: e.message }
    }
    throw e
  }
}
