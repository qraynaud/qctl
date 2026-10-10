/**
 * Unmask + start sshd/firewalld/cockpit/podman/QGA; apply baked DNAT via platform.networking.
 */
import { StageError } from '../errors.js'

/** @import { StageContext } from '../context.js' */

export default {
  name: 'start-services',
  describe: 'Unmask + start sshd/firewalld/cockpit/podman/QGA; apply baked DNAT',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const dnatPlan = ctx.platform?.networking?.planApplyDnat?.(ctx) ?? [
      'platform.networking.applyDnat',
    ]
    return [
      'unmask sshd/firewalld/cockpit/podman/qemu-guest-agent',
      'enable firewalld + permanent services; apply DNAT; reload',
      ...dnatPlan,
      'enable/restart cockpit.socket podman.socket; sshd; qemu-ga',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('start-services', 'must run as root')
    const applyDnat = ctx.platform?.networking?.applyDnat
    if (!applyDnat) {
      throw new StageError(
        'start-services',
        'platform.networking.applyDnat missing — stage qctl-platform-rocky.mjs with networking',
      )
    }

    try {
      ctx.log('rocky-services: start')
      for (const u of [
        'sshd.service',
        'sshd.socket',
        'firewalld.service',
        'cockpit.socket',
        'qemu-guest-agent.service',
        'podman.socket',
      ]) {
        await ctx.exec(['systemctl', 'unmask', u])
      }

      let r = await ctx.exec(['systemctl', 'enable', '--now', 'firewalld.service'])
      if (r.code !== 0) throw new Error(`enable firewalld failed: ${r.stderr.trim()}`)

      for (const svc of ['ssh', 'cockpit', 'http', 'https']) {
        r = await ctx.exec(['firewall-cmd', '--permanent', `--add-service=${svc}`])
        if (r.code !== 0) throw new Error(`firewall-cmd add-service ${svc} failed`)
      }

      await applyDnat(ctx)

      r = await ctx.exec(['firewall-cmd', '--reload'])
      if (r.code !== 0) throw new Error(`firewall-cmd --reload failed`)

      await ctx.exec(['systemctl', 'stop', 'cockpit.service', 'cockpit-wsinstance*'])
      r = await ctx.exec(['systemctl', 'enable', 'cockpit.socket', 'podman.socket'])
      if (r.code !== 0) throw new Error(`enable cockpit/podman sockets failed`)
      r = await ctx.exec(['systemctl', 'restart', 'cockpit.socket', 'podman.socket'])
      if (r.code !== 0) throw new Error(`restart cockpit/podman sockets failed`)
      r = await ctx.exec(['systemctl', 'enable', '--now', 'qemu-guest-agent.service'])
      if (r.code !== 0) throw new Error(`enable qemu-guest-agent failed`)
      r = await ctx.exec(['systemctl', 'enable', '--now', 'sshd.service'])
      if (r.code !== 0) throw new Error(`enable sshd failed`)

      const failed = await ctx.exec([
        'bash',
        '-c',
        "systemctl list-units --failed --plain --no-legend --no-pager 'cockpit*' 2>/dev/null | awk '{print $1}'",
      ])
      const units = failed.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      if (units.length > 0) {
        await ctx.exec(['systemctl', 'reset-failed', ...units])
        ctx.log(`rocky-services: reset-failed ${units.length} cockpit units`)
      }

      ctx.log('rocky-services: done (sshd/firewalld/cockpit/podman/qemu-ga)')
    } catch (err) {
      throw new StageError('start-services', err instanceof Error ? err.message : String(err))
    }
  },
}
