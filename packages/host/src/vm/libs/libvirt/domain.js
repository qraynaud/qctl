import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { sleep } from '../wait.js'
import { virsh } from './virsh.js'

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

/**
 * @param {string} connect
 * @param {string} name
 * @param {(xml: string) => string | null} transform
 * @param {string} label
 * @returns {Promise<boolean>}
 */
export async function redefineDomainXml(connect, name, transform, label) {
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
 * Wait out "in shutdown", then destroy if running/paused so define can change hardware.
 * @param {string} connect
 * @param {string} name
 * @param {string} reason
 */
export async function stopDomainForRedefine(connect, name, reason) {
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

  // Drop NVRAM + TPM state with the domain (recreate gets a fresh vTPM).
  let u = await virsh(connect, 'undefine', name, '--nvram', '--tpm').quiet().nothrow()
  if (u.exitCode !== 0 && (await domainExists(connect, name))) {
    u = await virsh(connect, 'undefine', name, '--nvram').quiet().nothrow()
  }
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
