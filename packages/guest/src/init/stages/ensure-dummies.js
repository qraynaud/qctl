/**
 * Ensure `type: dummy` ifaces from seed + install boot oneshot.
 * Replaces the vlan-parents stage (vlanN heuristic via vlan-parents.env).
 */
import { StageError } from '../errors.js'
import { dummyNamesFromSeed, installEnsureDummiesFromSeed } from './lib/ensure-dummies.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'ensure-dummies',
  describe: 'Ensure seed type:dummy ifaces + persistent boot unit',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const names = dummyNamesFromSeed(ctx.interfaces ?? ctx.seedConfig?.networking?.interfaces)
    return [
      names.length
        ? `ensure dummy ifaces: ${names.join(', ')}`
        : 'no type:dummy ifaces in seed (skip create)',
      'install qctl-ensure-dummies.service (every boot)',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('ensure-dummies', 'must run as root')
    try {
      await installEnsureDummiesFromSeed(ctx)
    } catch (err) {
      throw new StageError('ensure-dummies', err instanceof Error ? err.message : String(err))
    }
  },
}
