/**
 * Re-check egress; bring up eth0 if needed.
 * Lab VLAN dummy parents: {@link ./vlan-parents.js} (seed config + boot unit).
 * OS-specific work lives on `platform.networking` (guest loads the staged module).
 */
import { StageError } from '../errors.js'

/** @import { PlatformNetworkCtx } from '@qctl/shared' */
/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @returns {PlatformNetworkCtx}
 */
function networkCtx(ctx) {
  return { log: ctx.log, exec: ctx.exec, ports: ctx.ports }
}

export default {
  name: 'network-up',
  describe: 'Re-check egress; bring up eth0 if needed',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const net = ctx.platform?.networking
    if (net?.planEnsureUp) return net.planEnsureUp(networkCtx(ctx))
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
    await ensureUp(networkCtx(ctx))
  },
}
