import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { $, chalk } from 'zx'

import { passtDesiredFingerprint, passtForwardsXml, passtSummary } from './ports.js'
import { HOST_DEPS, die } from './util.js'
import { sleep } from './wait.js'

/** @import { PortEntry, VmArgv } from '../types.js' */

/**
 * Returns a zx ProcessPromise so callers can chain .nothrow() before await.
 * @param {string} connect
 * @param {...string} args
 */
export function virsh(connect, ...args) {
  return $`virsh -c ${connect} ${args}`
}

/**
 * @param {string} connect
 * @returns {Promise<void>}
 */
export async function ensureDefaultNetwork(connect) {
  if (connect.includes('session')) return
  const list = await virsh(connect, 'net-list', '--all').nothrow()
  if (list.exitCode !== 0) return
  const out = String(list.stdout)
  if (!/\bdefault\b/.test(out)) {
    die(`libvirt network 'default' is missing.\n\n${HOST_DEPS}`)
  }
  if (/^\s*default\s+active\b/m.test(out)) return
  console.log(chalk.cyan(`vm: starting libvirt network 'default'`))
  const start = await virsh(connect, 'net-start', 'default').nothrow()
  if (start.exitCode !== 0) {
    die(
      `could not start network 'default': ${String(start.stderr || start.stdout).trim()}\n\n${HOST_DEPS}`,
    )
  }
  await virsh(connect, 'net-autostart', 'default').nothrow()
}

/**
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function domainExists(connect, name) {
  const r = await virsh(connect, 'dominfo', name).quiet().nothrow()
  return r.exitCode === 0
}

/**
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<string | null>} libvirt domain state, or null if missing
 */
export async function domainState(connect, name) {
  const r = await virsh(connect, 'domstate', name).quiet().nothrow()
  if (r.exitCode !== 0) return null
  return String(r.stdout || '').trim() || null
}

/** Discard guest console — unread pty buffers block kernel printk (ttyS0) and freeze the VM. */
const SERIAL_NULL = `<serial type='null'>
      <target type='isa-serial' port='0'>
        <model name='isa-serial'/>
      </target>
    </serial>`

const CONSOLE_NULL = `<console type='null'>
      <target type='serial' port='0'/>
    </console>`

/**
 * @param {number|string} port
 * @returns {{ serial: string, console: string }}
 */
function serialTcpXml(port) {
  return {
    serial: `<serial type='tcp'>
      <source mode='connect' host='127.0.0.1' service='${port}'/>
      <protocol type='raw'/>
      <target type='isa-serial' port='0'>
        <model name='isa-serial'/>
      </target>
    </serial>`,
    console: `<console type='tcp'>
      <source mode='connect' host='127.0.0.1' service='${port}'/>
      <protocol type='raw'/>
      <target type='serial' port='0'/>
    </console>`,
  }
}

/**
 * @param {string} connect
 * @param {string} name
 * @param {(xml: string) => string | null} transform
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function redefineDomainXml(connect, name, transform, label) {
  const dump = await virsh(connect, 'dumpxml', name).nothrow()
  if (dump.exitCode !== 0) {
    die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  const next = transform(String(dump.stdout))
  if (next == null) return false

  const tmp = path.join(os.tmpdir(), `rocky-${name}-${label}.xml`)
  fs.writeFileSync(tmp, next, 'utf8')
  try {
    const def = await virsh(connect, 'define', tmp).nothrow()
    if (def.exitCode !== 0) {
      die(`define ${name} (${label}) failed: ${String(def.stderr || def.stdout).trim()}`)
    }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
  return true
}

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
 * @param {PortEntry[]} ports
 * @param {VmArgv | Record<string, unknown>} [argv]
 * @returns {string | null} new domain XML, or null if unchanged / not applicable
 */
export function patchPasstPortForwardsXml(xml, ports, argv = {}) {
  const desiredFp = passtDesiredFingerprint(ports, argv)
  const desiredXml = passtForwardsXml(ports, argv)
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
 * Wait out "in shutdown", then destroy if running/paused so define can change hardware.
 * @param {string} connect
 * @param {string} name
 * @param {string} reason
 */
async function stopDomainForRedefine(connect, name, reason) {
  let state = await domainState(connect, name)
  if (state === 'in shutdown') {
    const deadline = Date.now() + 120_000
    for (;;) {
      state = await domainState(connect, name)
      if (state !== 'in shutdown') break
      if (Date.now() >= deadline) {
        die(`domain ${name} still "in shutdown" after 120s`)
      }
      await sleep(1000)
    }
  }
  if (state === 'running' || state === 'paused') {
    console.log(chalk.cyan(`vm: stopping ${name} to ${reason}…`))
    const d = await virsh(connect, 'destroy', name).nothrow()
    if (d.exitCode !== 0) {
      die(`virsh destroy failed: ${String(d.stderr || d.stdout).trim()}`)
    }
  }
}

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
 * Align passt hostfwds on an existing domain from ports list.
 * Stops the guest if a redefine is needed. Returns true if XML changed.
 * @param {string} connect
 * @param {string} name
 * @param {PortEntry[]} ports
 * @param {VmArgv | Record<string, unknown>} [argv]
 * @returns {Promise<boolean>}
 */
export async function reconcilePasstPortForwards(connect, name, ports, argv = {}) {
  const dump = await virsh(connect, 'dumpxml', name).nothrow()
  if (dump.exitCode !== 0) {
    die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  if (patchPasstPortForwardsXml(String(dump.stdout), ports, argv) == null) {
    return false
  }

  await stopDomainForRedefine(
    connect,
    name,
    `update passt port forwards (${passtSummary(ports, argv)})`,
  )

  const ok = await redefineDomainXml(
    connect,
    name,
    (xml) => patchPasstPortForwardsXml(xml, ports, argv),
    'passt-fwd',
  )
  if (ok) {
    console.log(chalk.dim(`vm: passt hostfwd ${passtSummary(ports, argv)}`))
  }
  return ok
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

/**
 * Point guest serial at a host TCP listener (qemu mode=connect). Domain must be shut off.
 * @param {string} connect
 * @param {string} name
 * @param {number|string} port
 * @returns {Promise<boolean>}
 */
export async function setDomainSerialTcp(connect, name, port) {
  const { serial, console: cons } = serialTcpXml(port)
  const ok = await redefineDomainXml(
    connect,
    name,
    (xml) => {
      let next = xml
      if (/<serial\s+type=/i.test(next)) {
        next = next.replace(/<serial\s+type=['"][^'"]+['"][\s\S]*?<\/serial>/i, serial)
      } else {
        next = next.replace(/<\/devices>/i, `    ${serial}\n  </devices>`)
      }
      if (/<console\s+type=/i.test(next)) {
        next = next.replace(/<console\s+type=['"][^'"]+['"][\s\S]*?<\/console>/i, cons)
      } else {
        next = next.replace(/<\/devices>/i, `    ${cons}\n  </devices>`)
      }
      return next
    },
    'serial-tcp',
  )
  if (ok) console.log(chalk.dim(`vm: domain ${name} serial → tcp 127.0.0.1:${port}`))
  return ok
}

/**
 * Discard guest serial (null). Avoids pty backlog stalls when cloud image uses console=ttyS0.
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function setDomainSerialNull(connect, name) {
  const ok = await redefineDomainXml(
    connect,
    name,
    (xml) => {
      if (/<serial\s+type=['"]null['"]/i.test(xml)) return null
      let next = xml.replace(/<serial\s+type=['"][^'"]+['"][\s\S]*?<\/serial>/i, SERIAL_NULL)
      if (/<console\s+type=/i.test(next)) {
        next = next.replace(/<console\s+type=['"][^'"]+['"][\s\S]*?<\/console>/i, CONSOLE_NULL)
      }
      return next
    },
    'serial-null',
  )
  if (ok) console.log(chalk.dim(`vm: domain ${name} serial → null (discard)`))
  return ok
}

/**
 * After serial TCP console follow: stop dead TCP reconnect spin, switch to null serial,
 * start again. Also converts leftover pty → null (unread pty stalls console=ttyS0 guests).
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function restartWithSerialNull(connect, name) {
  const dump = await virsh(connect, 'dumpxml', name).nothrow()
  if (dump.exitCode !== 0) {
    die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  const xml = String(dump.stdout)
  if (/<serial\s+type=['"]null['"]/i.test(xml)) {
    return false
  }

  await stopDomainForRedefine(connect, name, 'detach serial console (→ null)')
  await setDomainSerialNull(connect, name)

  console.log(chalk.cyan(`vm: starting ${name} with null serial…`))
  const r = await virsh(connect, 'start', name).nothrow()
  if (r.exitCode !== 0) {
    die(`virsh start failed: ${String(r.stderr || r.stdout).trim()}`)
  }
  return true
}

/**
 * Destroy (if running) + undefine. Suppresses expected virsh noise (already gone / no NVRAM).
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function removeDomain(connect, name) {
  if (!(await domainExists(connect, name))) return false

  const stateR = await virsh(connect, 'domstate', name).quiet().nothrow()
  const state = String(stateR.stdout || '').trim()
  if (state === 'running' || state === 'paused' || state === 'in shutdown') {
    console.log(chalk.cyan(`vm: destroying domain ${name} (was ${state})`))
    await virsh(connect, 'destroy', name).quiet().nothrow()
  }

  let u = await virsh(connect, 'undefine', name, '--nvram').quiet().nothrow()
  if (u.exitCode !== 0 && (await domainExists(connect, name))) {
    u = await virsh(connect, 'undefine', name).quiet().nothrow()
  }
  if (await domainExists(connect, name)) {
    die(
      `failed to undefine domain ${name}: ${String(u.stderr || u.stdout || '').trim() || `exit ${u.exitCode}`}`,
    )
  }
  console.log(chalk.dim(`vm: domain ${name} undefined`))
  return true
}
