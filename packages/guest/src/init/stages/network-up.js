/**
 * Re-check egress; bring up eth0 if needed (bootcmd owns macvlan parents).
 * OS-specific work lives on `platform.networking` (guest loads the staged module).
 */
import { StageError } from '../errors.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'network-up',
  describe: 'Re-check egress; bring up eth0 if needed (bootcmd owns macvlan parents)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const net = ctx.platform?.networking
    if (net?.planEnsureUp) return net.planEnsureUp(ctx)
    return ['platform.networking.ensureUp (load platform module)']
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    const ensureUp = ctx.platform?.networking?.ensureUp
    if (!ensureUp) {
      throw new StageError(
        'network-up',
        'platform.networking.ensureUp missing — stage qctl-platform-rocky.mjs with networking',
      )
    }
    await ensureUp(ctx)
  },
}
