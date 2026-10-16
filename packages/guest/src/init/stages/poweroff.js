/**
 * init-tank: power the VM off so the host can destroy --keep-persistent.
 */
import { StageError } from '../errors.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'poweroff',
  describe: 'init-tank: power the VM off so the host can destroy --keep-persistent',
  /**
   * @param {StageContext} _ctx
   */
  plan(_ctx) {
    return ['sync; systemctl poweroff --no-block']
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    ctx.log('rocky-init-tank: OK — powering off (host will destroy --keep-persistent)')
    await ctx.exec(['sync'])
    await Bun.sleep(1000)
    const r = await ctx.exec(['systemctl', 'poweroff', '--no-block'])
    if (r.code !== 0) {
      const p = await ctx.exec(['poweroff'])
      if (p.code !== 0) {
        throw new StageError(
          'poweroff',
          `poweroff failed (systemctl=${r.code}, poweroff=${p.code})`,
        )
      }
    }
  },
}
