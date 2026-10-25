/**
 * Detach appliance seed CDROM from a libvirt domain (NoCloud ISO).
 */
import { chalk } from 'zx'

import { redefineDomainXml, stopDomainForRedefine } from './domain.js'

/**
 * Remove every `device='cdrom'` disk. Returns null when none present.
 * @param {string} xml
 * @returns {string | null}
 */
export function patchDetachSeedCdromXml(xml) {
  if (!/<disk\b[^>]*\bdevice=['"]cdrom['"]/i.test(xml)) return null
  const next = xml.replace(/<disk\b[^>]*\bdevice=['"]cdrom['"][^>]*>[\s\S]*?<\/disk>\s*/gi, '')
  return next === xml ? null : next
}

/**
 * Stop if needed, redefine without seed CDROM. No-op when none attached.
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<boolean>} true when XML was changed
 */
export async function detachSeedCdrom(connect, name) {
  await stopDomainForRedefine(connect, name, 'detach seed CDROM')
  const ok = await redefineDomainXml(connect, name, patchDetachSeedCdromXml, 'seed-cdrom')
  if (ok) console.log(chalk.dim(`vm: domain ${name} seed CDROM detached`))
  return ok
}
