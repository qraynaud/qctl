import { chalk } from 'zx'

import { passtDesiredFingerprint, passtForwardsXml, passtSummary } from '../../../lib/ports.js'
import { die } from '../../../lib/util.js'
import { redefineDomainXml, stopDomainForRedefine } from './domain.js'
import { virsh } from './virsh.js'

/** @import { PortsMap } from '../../types.js' */

/**
 * @param {string} ifaceXml
 * @returns {string}
 */
function passtForwardFingerprint(ifaceXml) {
  const out = []
  const re = /<portForward\b([^>]*)>([\s\S]*?)<\/portForward>/gi
  for (const m of ifaceXml.matchAll(re)) {
    const attrs = m[1]
    const body = m[2]
    const proto = /proto=['"]([^'"]+)['"]/i.exec(attrs)?.[1] || ''
    const address = /address=['"]([^'"]+)['"]/i.exec(attrs)?.[1] || ''
    const start = /start=['"]([^'"]+)['"]/i.exec(body)?.[1] || ''
    const to = /to=['"]([^'"]+)['"]/i.exec(body)?.[1] || start
    out.push(`${proto}|${address}|${start}|${to}`)
  }
  return out.sort().join(';')
}

/**
 * Rewrite passt <portForward> on user interfaces from ports list (host→guest on 127.0.0.1).
 * @param {string} xml
 * @param {PortsMap} ports
 * @returns {string | null} new domain XML, or null if unchanged / not applicable
 */
export function patchPasstPortForwardsXml(xml, ports) {
  const desiredFp = passtDesiredFingerprint(ports)
  const desiredXml = passtForwardsXml(ports)
  if (!desiredXml) return null
  let touched = false
  let anyPasst = false

  const next = xml.replace(/<interface\s+type=['"]user['"][\s\S]*?<\/interface>/gi, (block) => {
    if (!/<backend\s+type=['"]passt['"]/i.test(block)) return block
    anyPasst = true
    if (passtForwardFingerprint(block) === desiredFp) return block
    touched = true
    let b = block.replace(/<portForward\b[\s\S]*?<\/portForward>\s*/gi, '')
    if (/<model\s/i.test(b)) {
      b = b.replace(/(\n[ \t]*)(<model\s)/i, `\n${desiredXml}$1$2`)
    } else if (/<backend\s/i.test(b)) {
      b = b.replace(/(\n[ \t]*)(<backend\s)/i, `\n${desiredXml}$1$2`)
    } else {
      b = b.replace(/(<interface\s+type=['"]user['"][^>]*>)/i, `$1\n${desiredXml}`)
    }
    return b
  })

  if (!anyPasst || !touched) return null
  return next
}

/**
 * Align passt hostfwds on an existing domain from ports list.
 * Stops the guest if a redefine is needed. Returns true if XML changed.
 * @param {string} connect
 * @param {string} name
 * @param {PortsMap} ports
 * @returns {Promise<boolean>}
 */
export async function reconcilePasstPortForwards(connect, name, ports) {
  const dump = await virsh(connect, 'dumpxml', name).nothrow()
  if (dump.exitCode !== 0) {
    die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  if (patchPasstPortForwardsXml(String(dump.stdout), ports) == null) {
    return false
  }

  await stopDomainForRedefine(connect, name, `update passt port forwards (${passtSummary(ports)})`)

  const ok = await redefineDomainXml(
    connect,
    name,
    (xml) => patchPasstPortForwardsXml(xml, ports),
    'passt-fwd',
  )
  if (ok) {
    console.log(chalk.dim(`vm: passt hostfwd ${passtSummary(ports)}`))
  }
  return ok
}
