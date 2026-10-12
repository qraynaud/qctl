import { $, chalk, fs, path } from 'zx'

import { DATA_COUNT, SPECIAL_COUNT, getVms } from '../../lib/paths.js'
import { requireBins } from '../../lib/util.js'

/**
 * @typedef {{
 *   dir: string,
 *   os: string,
 *   vw: string,
 *   data: string[],
 *   special: string[],
 * }} VmDiskPaths
 */

/**
 * @param {string} name
 * @returns {VmDiskPaths}
 */
export function vmPaths(name) {
  const dir = path.join(getVms(), name)
  /** @type {string[]} */
  const data = []
  for (let i = 0; i < DATA_COUNT; i++) data.push(path.join(dir, `data${i}.qcow2`))
  /** @type {string[]} */
  const special = []
  for (let i = 0; i < SPECIAL_COUNT; i++) special.push(path.join(dir, `special${i}.qcow2`))
  return {
    dir,
    os: path.join(dir, 'os.qcow2'),
    vw: path.join(dir, 'vw.qcow2'),
    data,
    special,
  }
}

/**
 * Non-OS disks kept across --keep-data / --wipe-os.
 * @param {VmDiskPaths} p
 * @returns {string[]}
 */
export function persistentDisks(p) {
  return [p.vw, ...p.data, ...p.special]
}

/**
 * @param {string} file
 * @param {string} size
 * @param {string} label
 */
async function ensureQcow(file, size, label) {
  if (fs.existsSync(file)) {
    console.log(chalk.dim(`vm: keep ${label} ${file}`))
    return
  }
  console.log(chalk.cyan(`vm: ${label} ${size} → ${file}`))
  await $`qemu-img create -f qcow2 ${file} ${size}`
}

/**
 * @param {{
 *   name: string,
 *   baseImage: string,
 *   vwSize: string,
 *   dataSize: string,
 *   specialSize: string,
 *   wipeOs?: boolean,
 *   wipeTank?: boolean,
 *   dryRun?: boolean,
 * }} opts
 * @returns {Promise<VmDiskPaths>}
 */
export async function ensureDisks({
  name,
  baseImage,
  vwSize,
  dataSize,
  specialSize,
  wipeOs,
  wipeTank,
  dryRun,
}) {
  const p = vmPaths(name)
  if (dryRun) {
    console.log(
      chalk.dim(
        `vm: would ensure under ${p.dir}: os, vw, data×${DATA_COUNT}, special×${SPECIAL_COUNT}`
          + (wipeTank ? ' (wipe tank vdevs)' : ''),
      ),
    )
    return p
  }
  await requireBins(['qemu-img'])
  await fs.mkdirp(p.dir)

  if (wipeOs && fs.existsSync(p.os)) {
    console.log(chalk.yellow(`vm: wiping OS disk ${p.os}`))
    await fs.remove(p.os)
  }

  if (!fs.existsSync(p.os)) {
    console.log(chalk.cyan(`vm: OS overlay → ${p.os}`))
    await $`qemu-img create -f qcow2 -F qcow2 -b ${baseImage} ${p.os}`
    await $`qemu-img resize ${p.os} 20G`
  } else {
    console.log(chalk.dim(`vm: keep OS ${p.os}`))
  }

  await ensureQcow(p.vw, vwSize, '/vw')

  if (wipeTank) {
    for (const f of [...p.data, ...p.special]) {
      if (fs.existsSync(f)) {
        console.log(chalk.yellow(`vm: wipe tank disk ${f}`))
        await fs.remove(f)
      }
    }
  }

  for (let i = 0; i < DATA_COUNT; i++) {
    await ensureQcow(p.data[i], dataSize, `data${i}`)
  }
  for (let i = 0; i < SPECIAL_COUNT; i++) {
    await ensureQcow(p.special[i], specialSize, `special${i}`)
  }
  return p
}
