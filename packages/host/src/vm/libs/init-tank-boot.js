/**
 * Disposable Rocky root for `vm init-tank` only.
 *
 * GenericCloud + ZoL needs a writable block root — not a RAM/live image — so we
 * attach a throwaway overlay (local) / import volume (Proxmox), boot it first,
 * then delete it. Provision `disks.os` is never wiped by init-tank.
 */
import { existsSync } from 'node:fs'

import { $, chalk, fs, path } from 'zx'

import { getVms } from '../../lib/paths.js'
import { requireBins } from '../../lib/util.js'

/** Basename / Proxmox serial marker for the disposable boot disk. */
export const INIT_TANK_BOOT_ID = 'init-tank-boot'

/**
 * @param {string} name VM / domain name
 * @returns {string}
 */
export function initTankBootQcowPath(name) {
  return path.join(getVms(), name, `${INIT_TANK_BOOT_ID}.qcow2`)
}

/**
 * Always-recreate qcow2 overlay on the pinned Rocky base image.
 * @param {{ name: string, baseImage: string, size?: string }} opts
 * @returns {Promise<string>} absolute path to the boot qcow
 */
export async function ensureInitTankBootDisk({ name, baseImage, size }) {
  await requireBins(['qemu-img'])
  const file = initTankBootQcowPath(name)
  await fs.mkdirp(path.dirname(file))
  if (existsSync(file)) {
    console.log(chalk.yellow(`vm: recreate init-tank boot ${file}`))
    await fs.remove(file)
  } else {
    console.log(chalk.cyan(`vm: init-tank boot overlay → ${file}`))
  }
  await $`qemu-img create -f qcow2 -F qcow2 -b ${baseImage} ${file}`
  if (size) await $`qemu-img resize ${file} ${size}`
  return file
}

/**
 * @param {string} name
 * @returns {Promise<boolean>} true if a file was removed
 */
export async function removeInitTankBootDisk(name) {
  const file = initTankBootQcowPath(name)
  if (!existsSync(file)) return false
  console.log(chalk.yellow(`vm: remove init-tank boot ${file}`))
  await fs.remove(file)
  return true
}
