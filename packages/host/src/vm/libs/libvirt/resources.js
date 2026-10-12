import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { redefineDomainXml, stopDomainForRedefine } from './domain.js'
import { virsh } from './virsh.js'

/**
 * Convert libvirt memory amount + unit → MiB (rounded).
 * @param {string|number} value
 * @param {string} [unit]
 * @returns {number | null}
 */
function memoryToMiB(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const u = String(unit || 'KiB').toLowerCase()
  if (u === 'b' || u === 'bytes') return Math.round(n / (1024 * 1024))
  if (u === 'kib' || u === 'ki') return Math.round(n / 1024)
  if (u === 'mib' || u === 'mi' || u === 'm' || u === 'mb') return Math.round(n)
  if (u === 'gib' || u === 'gi' || u === 'g' || u === 'gb') return Math.round(n * 1024)
  return Math.round(n / 1024)
}

/**
 * Align domain <memory>/<currentMemory>/<vcpu> with desired MiB + vCPU count.
 * @param {string} xml
 * @param {{ memory: number|string, vcpus: number|string }} opts
 * @returns {string | null} new XML, or null if unchanged
 */
export function patchDomainResourcesXml(xml, { memory, vcpus }) {
  const wantMiB = Number(memory)
  const wantVcpus = Number(vcpus)
  if (!Number.isInteger(wantMiB) || wantMiB < 1) {
    throw new Error(`memory must be a positive integer MiB (got ${memory})`)
  }
  if (!Number.isInteger(wantVcpus) || wantVcpus < 1) {
    throw new Error(`vcpus must be a positive integer (got ${vcpus})`)
  }
  const wantKiB = wantMiB * 1024
  let next = xml
  let changed = false

  const memM = /<memory(\s[^>]*)?>(\d+)<\/memory>/i.exec(next)
  if (memM) {
    const unit = /unit=['"]([^'"]+)['"]/i.exec(memM[1] || '')?.[1]
    if (memoryToMiB(memM[2], unit) !== wantMiB) {
      next = next.replace(
        /<memory(\s[^>]*)?>\d+<\/memory>/i,
        `<memory unit='KiB'>${wantKiB}</memory>`,
      )
      changed = true
    }
  }

  const curM = /<currentMemory(\s[^>]*)?>(\d+)<\/currentMemory>/i.exec(next)
  if (curM) {
    const unit = /unit=['"]([^'"]+)['"]/i.exec(curM[1] || '')?.[1]
    if (memoryToMiB(curM[2], unit) !== wantMiB) {
      next = next.replace(
        /<currentMemory(\s[^>]*)?>\d+<\/currentMemory>/i,
        `<currentMemory unit='KiB'>${wantKiB}</currentMemory>`,
      )
      changed = true
    }
  }

  const vcpuM = /<vcpu(\s[^>]*)?>(\d+)<\/vcpu>/i.exec(next)
  if (vcpuM && Number(vcpuM[2]) !== wantVcpus) {
    const attrs = vcpuM[1] || ''
    next = next.replace(/<vcpu(\s[^>]*)?>\d+<\/vcpu>/i, `<vcpu${attrs}>${wantVcpus}</vcpu>`)
    changed = true
  }

  // virt-install default is sockets=N; prefer 1 socket × N cores for the guest scheduler.
  const topoEl = `<topology sockets='1' dies='1' cores='${wantVcpus}' threads='1'/>`
  const cpuOpen = /<cpu(\s[^>]*)?\/>/i.exec(next)
  if (cpuOpen) {
    const attrs = cpuOpen[1] || ''
    next = next.replace(/<cpu(\s[^>]*)?\/>/i, `<cpu${attrs}>\n    ${topoEl}\n  </cpu>`)
    changed = true
  } else if (/<cpu\b/i.test(next)) {
    if (/<topology\b/i.test(next)) {
      const sockets = Number(/<topology[^>]*sockets=['"](\d+)['"]/i.exec(next)?.[1] || 0)
      const cores = Number(/<topology[^>]*cores=['"](\d+)['"]/i.exec(next)?.[1] || 0)
      if (sockets !== 1 || cores !== wantVcpus) {
        next = next.replace(/<topology\b[^>]*\/?>/i, topoEl)
        changed = true
      }
    } else {
      next = next.replace(/(<cpu\b[^>]*>)/i, `$1\n    ${topoEl}`)
      changed = true
    }
  }

  return changed ? next : null
}

/**
 * Align memory (MiB) + vCPU count on an existing domain.
 * Stops the guest if a redefine is needed. Returns true if XML changed.
 * @param {string} connect
 * @param {string} name
 * @param {{ memory: number|string, vcpus: number|string }} opts
 * @returns {Promise<boolean>}
 */
export async function reconcileDomainResources(connect, name, { memory, vcpus }) {
  const dump = await virsh(connect, 'dumpxml', name).nothrow()
  if (dump.exitCode !== 0) {
    die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  if (patchDomainResourcesXml(String(dump.stdout), { memory, vcpus }) == null) {
    return false
  }

  await stopDomainForRedefine(connect, name, `update memory=${memory}MiB vcpus=${vcpus}`)

  const ok = await redefineDomainXml(
    connect,
    name,
    (xml) => patchDomainResourcesXml(xml, { memory, vcpus }),
    'resources',
  )
  if (ok) {
    console.log(chalk.dim(`vm: domain ${name} memory=${memory}MiB vcpus=${vcpus}`))
  }
  return ok
}
