import { fs } from 'zx'

import { portsFromArgv } from '../../../lib/options.js'
import { requireBins } from '../../../lib/util.js'
import { vmPaths } from '../../libs/disks.js'
import { virsh } from '../../libs/libvirt/index.js'
import { resolveProvisionDisks } from '../../libs/resolve-provision-disks.js'
import { localSshHints } from '../../libs/ssh-hints.js'
import { connectOf, powerState } from './ops.js'

/** @import { VmContext, VmStatusSnapshot } from '../../driver-contract.js' */

/**
 * Gather workstation status + shell hints (no printing).
 * @param {VmContext} ctx
 * @returns {Promise<VmStatusSnapshot>}
 */
export async function getStatus(ctx) {
  const connect = connectOf(ctx)
  const name = String(ctx.name).trim()
  const power = await powerState(ctx)
  const network = 'user'
  const ports = portsFromArgv({
    env: ctx.env,
    target: 'workstation',
    profile: ctx.profile,
  })

  await requireBins(['virsh'])
  const r = await virsh(connect, 'dominfo', name).nothrow()
  if (r.exitCode !== 0) {
    /** @type {VmStatusSnapshot} */
    const snap = {
      power: power.kind === 'absent' ? power : { kind: 'absent' },
      summary: `domain ${name} not defined`,
    }
    try {
      const resolved = await resolveProvisionDisks({
        env: ctx.env || 'dev',
        target: 'workstation',
        profile: ctx.profile,
      })
      const p = vmPaths(name, resolved)
      snap.disks = [
        { id: 'os', path: p.os.path, exists: fs.existsSync(p.os.path) },
        ...p.attached.map((e) => ({
          id: e.id,
          path: e.path,
          exists: fs.existsSync(e.path),
        })),
      ]
    } catch (err) {
      snap.fields = {
        disksError: err instanceof Error ? err.message : String(err),
      }
    }
    return snap
  }

  return {
    power,
    summary: String(r.stdout).trim(),
    hints: await localSshHints({ connect, name, ports, network }),
  }
}
