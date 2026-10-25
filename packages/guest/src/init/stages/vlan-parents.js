/**
 * Ensure lab VLAN dummy parents from seed config + install boot oneshot.
 * Replaces cloud-init bootcmd that created ephemeral dummies once.
 */
import { StageError } from '../errors.js'
import { installVlanParentsFromSeed, labDummyParentsFromMap } from './lib/vlan-parents.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'vlan-parents',
  describe: 'Ensure lab VLAN dummy parents from seed + persistent boot unit',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const map = ctx.seedConfig?.vlanParents || {}
    const names = labDummyParentsFromMap(map)
    return [
      names.length
        ? `ensure dummy ifaces: ${names.join(', ')}`
        : 'no lab vlanN parents in seed (skip create)',
      'install qctl-vlan-parents.service (every boot)',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('vlan-parents', 'must run as root')
    try {
      await installVlanParentsFromSeed(ctx)
    } catch (err) {
      throw new StageError('vlan-parents', err instanceof Error ? err.message : String(err))
    }
  },
}
