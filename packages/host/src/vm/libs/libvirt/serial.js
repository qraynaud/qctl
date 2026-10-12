import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { redefineDomainXml, stopDomainForRedefine } from './domain.js'
import { virsh } from './virsh.js'

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
 * Point domain serial/console at a host TCP listener. Returns null if unchanged.
 * @param {string} xml
 * @param {number|string} port
 * @returns {string}
 */
export function patchSerialTcpXml(xml, port) {
  const { serial, console: cons } = serialTcpXml(port)
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
}

/**
 * Discard guest serial (null). Returns null when already null.
 * @param {string} xml
 * @returns {string | null}
 */
export function patchSerialNullXml(xml) {
  if (/<serial\s+type=['"]null['"]/i.test(xml)) return null
  let next = xml.replace(/<serial\s+type=['"][^'"]+['"][\s\S]*?<\/serial>/i, SERIAL_NULL)
  if (/<console\s+type=/i.test(next)) {
    next = next.replace(/<console\s+type=['"][^'"]+['"][\s\S]*?<\/console>/i, CONSOLE_NULL)
  }
  return next
}

/**
 * Point guest serial at a host TCP listener (qemu mode=connect). Domain must be shut off.
 * @param {string} connect
 * @param {string} name
 * @param {number|string} port
 * @returns {Promise<boolean>}
 */
export async function setDomainSerialTcp(connect, name, port) {
  const ok = await redefineDomainXml(
    connect,
    name,
    (xml) => patchSerialTcpXml(xml, port),
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
  const ok = await redefineDomainXml(connect, name, patchSerialNullXml, 'serial-null')
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
