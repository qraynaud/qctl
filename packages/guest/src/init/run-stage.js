import { UnknownStageError } from './errors.js'
import { REGISTRY } from './stages/index.js'

/** @import { StageContext } from './context.js' */
/** @import { StageError } from './errors.js' */

/**
 * Run one platform stage. With `ctx.dryRun` only prints the plan.
 *
 * @param {string} name
 * @param {StageContext} ctx
 * @returns {Promise<void>}
 * @throws {UnknownStageError | StageError}
 */
export async function runStage(name, ctx) {
  const stage = REGISTRY.get(name)
  if (!stage) throw new UnknownStageError(name)

  if (ctx.dryRun) {
    ctx.log(`dry-run: stage ${name} (profile=${ctx.profile}) — ${stage.describe}`)
    for (const line of stage.plan(ctx)) ctx.log(`dry-run:   ${line}`)
    return
  }
  await stage.run(ctx)
}
