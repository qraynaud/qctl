/**
 * Attach / detach disposable init-tank boot disk on an existing libvirt domain.
 * Leaves disks.os in place; boot order prefers the disposable disk.
 */
import { chalk } from 'zx'

import { INIT_TANK_BOOT_ID } from '../init-tank-boot.js'
import { redefineDomainXml, stopDomainForRedefine } from './domain.js'

/**
 * @param {string} xml
 * @returns {string[]}
 */
function virtioTargets(xml) {
  /** @type {string[]} */
  const out = []
  for (const m of xml.matchAll(/\bdev=['"](vd[a-z]+)['"]/gi)) {
    out.push(m[1].toLowerCase())
  }
  return out
}

/**
 * @param {string} xml
 * @returns {string}
 */
export function nextVirtioTarget(xml) {
  const used = new Set(virtioTargets(xml))
  for (let i = 0; i < 26; i++) {
    const t = `vd${String.fromCharCode(97 + i)}`
    if (!used.has(t)) return t
  }
  throw new Error('libvirt init-tank: no free virtio target (vd*)')
}

/**
 * Drop disks whose serial is init-tank-boot (aborted prior run).
 * @param {string} xml
 * @returns {string | null}
 */
export function patchRemoveInitTankBootXml(xml) {
  const re = /<disk\b[^>]*>[\s\S]*?<serial>\s*init-tank-boot\s*<\/serial>[\s\S]*?<\/disk>\s*/gi
  if (!re.test(xml)) return null
  re.lastIndex = 0
  const next = xml.replace(re, '')
  return next === xml ? null : next
}

/**
 * Insert disposable boot disk with boot order 1; demote other disk boot orders.
 * @param {string} xml
 * @param {{ bootDiskPath: string, target: string }} opts
 * @returns {string | null}
 */
export function patchAttachInitTankBootXml(xml, opts) {
  const { bootDiskPath, target } = opts
  if (!bootDiskPath || !target) return null
  // Already attached?
  if (new RegExp(`<serial>\\s*${INIT_TANK_BOOT_ID}\\s*</serial>`, 'i').test(xml)) {
    return null
  }
  let next = xml.replace(/\s*<boot\s+order=['"]\d+['"]\s*\/>/gi, '')
  const disk = `
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='${bootDiskPath}'/>
      <target dev='${target}' bus='virtio'/>
      <serial>${INIT_TANK_BOOT_ID}</serial>
      <boot order='1'/>
    </disk>
`
  if (!/<devices>/i.test(next)) return null
  next = next.replace(/<devices>/i, `<devices>${disk}`)
  return next
}

/**
 * Attach seed ISO as CDROM when missing.
 * @param {string} xml
 * @param {string} isoPath
 * @returns {string | null}
 */
export function patchAttachSeedCdromXml(xml, isoPath) {
  if (!isoPath) return null
  if (/<disk\b[^>]*\bdevice=['"]cdrom['"]/i.test(xml)) {
    // Replace source path if present
    const replaced = xml.replace(
      /(<disk\b[^>]*\bdevice=['"]cdrom['"][^>]*>[\s\S]*?<source\s+file=['"])([^'"]+)(['"])/i,
      `$1${isoPath}$3`,
    )
    return replaced === xml ? null : replaced
  }
  const disk = `
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='${isoPath}'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>
`
  if (!/<devices>/i.test(xml)) return null
  return xml.replace(/<devices>/i, `<devices>${disk}`)
}

/**
 * Stop domain, attach disposable boot (+ seed ISO), leave disks.os.
 * @param {string} connect
 * @param {string} name
 * @param {{ bootDiskPath: string, seedIsoPath?: string }} opts
 */
export async function attachInitTankBootDisk(connect, name, opts) {
  const bootDiskPath = String(opts.bootDiskPath || '').trim()
  if (!bootDiskPath) throw new Error('attachInitTankBootDisk: bootDiskPath required')

  await stopDomainForRedefine(connect, name, 'attach init-tank boot disk')
  await redefineDomainXml(connect, name, patchRemoveInitTankBootXml, 'init-tank-boot-clear')

  await redefineDomainXml(
    connect,
    name,
    (xml) => {
      const target = nextVirtioTarget(xml)
      console.log(
        chalk.cyan(
          `vm: appliance ${name}: disposable boot ${target} (keep disks.os); boot order=1`,
        ),
      )
      return patchAttachInitTankBootXml(xml, { bootDiskPath, target })
    },
    'init-tank-boot-attach',
  )

  const iso = opts.seedIsoPath?.trim()
  if (iso) {
    await redefineDomainXml(
      connect,
      name,
      (xml) => patchAttachSeedCdromXml(xml, iso),
      'init-tank-seed',
    )
  }
}

/**
 * Stop domain, remove disposable boot disk XML (never disks.os).
 * @param {string} connect
 * @param {string} name
 */
export async function detachInitTankBootDisk(connect, name) {
  await stopDomainForRedefine(connect, name, 'detach init-tank boot disk')
  const ok = await redefineDomainXml(
    connect,
    name,
    patchRemoveInitTankBootXml,
    'init-tank-boot-detach',
  )
  if (ok) console.log(chalk.dim(`vm: domain ${name} init-tank boot detached`))
}
