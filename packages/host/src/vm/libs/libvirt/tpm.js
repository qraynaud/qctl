import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import { redefineDomainXml, stopDomainForRedefine } from './domain.js'
import { virsh } from './virsh.js'

/** Emulated TPM 2.0 (CRB) — matches virt-install `--tpm default` on modern hosts. */
const TPM_XML = `<tpm model='tpm-crb'>
      <backend type='emulator' version='2.0'/>
    </tpm>`

/**
 * Ensure domain XML has an emulated TPM 2.0. Returns null when already present.
 * @param {string} xml
 * @returns {string | null}
 */
export function patchDomainTpmXml(xml) {
  if (/<tpm\b/i.test(xml)) return null
  if (!/<\/devices>/i.test(xml)) return null
  return xml.replace(/<\/devices>/i, `    ${TPM_XML}\n  </devices>`)
}

/**
 * Add emulated TPM 2.0 when missing. Stops the guest if a redefine is needed.
 * @param {string} connect
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function reconcileDomainTpm(connect, name) {
  const dump = await virsh(connect, 'dumpxml', name).nothrow()
  if (dump.exitCode !== 0) {
    die(`dumpxml ${name} failed: ${String(dump.stderr || dump.stdout).trim()}`)
  }
  if (patchDomainTpmXml(String(dump.stdout)) == null) return false

  await stopDomainForRedefine(connect, name, 'add emulated TPM 2.0')

  const ok = await redefineDomainXml(connect, name, patchDomainTpmXml, 'tpm')
  if (ok) console.log(chalk.dim(`vm: domain ${name} tpm=emulator/2.0`))
  return ok
}
