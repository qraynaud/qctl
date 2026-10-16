/**
 * NoCloud seed ISO: path resolution, stage walk, ISO build, ensureSeed.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'

import { ISOWriter } from '@gcu/iso9660'
import { chalk, fs, path } from 'zx'

import { getSeed } from '../../../lib/paths.js'
import { die } from '../../../lib/util.js'

/** @import { SeedProfile as VmSeedProfile } from '../../types.js' */

/** @typedef {VmSeedProfile} SeedProfile */

/**
 * Env-scoped seed artifact paths under `$XDG_CACHE_HOME/qctl/repos/<hash>/seed/<env>/`.
 * Durable outputs: nocloud.iso + instance-id (`cidata.img` is legacy read-only).
 * @param {SeedProfile | string} profileName
 * @param {string} env
 */
export function resolveSeedPaths(profileName, env = 'dev') {
  const e = env || 'dev'
  const root = path.join(getSeed(), e)
  if (profileName === 'init-tank') {
    const base = path.join(root, 'init-tank')
    return {
      userData: 'user-data.yaml',
      root: base,
      isoName: 'nocloud.iso',
      isoPath: path.join(base, 'nocloud.iso'),
      imgName: 'cidata.img',
      imgPath: path.join(base, 'cidata.img'),
      instanceIdPath: path.join(base, 'instance-id'),
    }
  }
  return {
    userData: 'user-data.yaml',
    root,
    isoName: 'nocloud.iso',
    isoPath: path.join(root, 'nocloud.iso'),
    imgName: 'cidata.img',
    imgPath: path.join(root, 'cidata.img'),
    instanceIdPath: path.join(root, 'instance-id'),
  }
}

/**
 * Prefer ISO; legacy FAT img still accepted if present from older seeds.
 *
 * @param {{ isoPath?: string | null, imgPath?: string | null }} opts
 * @returns {Promise<{ path: string, format: 'raw', device: 'cdrom' | 'disk' }>}
 */
export async function ensureSeed({ isoPath, imgPath }) {
  if (isoPath && fs.existsSync(isoPath)) {
    console.log(chalk.dim(`vm: seed ISO ${isoPath}`))
    return { path: isoPath, format: 'raw', device: 'cdrom' }
  }
  if (imgPath && fs.existsSync(imgPath)) {
    console.log(chalk.dim(`vm: seed FAT ${imgPath} (legacy)`))
    return { path: imgPath, format: 'raw', device: 'disk' }
  }
  die(
    `no seed ISO at ${isoPath || '(no iso)'}`
      + `\n  Run: qctl vm seed`
      + (isoPath && String(isoPath).includes('init-tank') ? ' --seed-profile init-tank' : ''),
  )
}

/**
 * Walk a stage directory into flat ISO paths (files only; skip empty).
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Promise<{ path: string, data: Uint8Array }[]>}
 */
async function collectStageFiles(dir, prefix = '') {
  /** @type {{ path: string, data: Uint8Array }[]} */
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name
    const abs = pathJoin(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await collectStageFiles(abs, rel)))
      continue
    }
    if (!ent.isFile()) continue
    const buf = await readFile(abs)
    if (buf.byteLength === 0) {
      console.log(chalk.dim(`  seed ISO: skip empty ${rel}`))
      continue
    }
    out.push({ path: rel, data: new Uint8Array(buf) })
  }
  return out
}

/**
 * Build a NoCloud ISO (label `cidata`, Joliet) with pure JS — no host ISO tools.
 * @param {string} stageDir
 * @param {string} isoPath
 */
export async function buildIso(stageDir, isoPath) {
  const files = await collectStageFiles(stageDir)
  const names = new Set(files.map((f) => f.path))
  if (!names.has('user-data') || !names.has('meta-data')) {
    die('seed stage missing user-data or meta-data')
  }

  const writer = new ISOWriter({
    volumeId: 'cidata',
    joliet: true,
    greeting: false,
    application: 'qctl',
  })
  for (const f of files) writer.add(f.path, f.data)

  const iso = writer.toUint8Array()
  const tmpIso = `${isoPath}.tmp`
  await fs.remove(tmpIso).catch(() => {})
  await fs.writeFile(tmpIso, iso)
  await fs.remove(isoPath).catch(() => {})
  await fs.move(tmpIso, isoPath)
  console.log(chalk.green(`vm seed: ISO -> ${isoPath}`))
}

/**
 * @param {string} instanceIdPath
 * @returns {string | null}
 */
export function readExistingInstanceId(instanceIdPath) {
  if (!fs.existsSync(instanceIdPath)) return null
  try {
    const t = String(fs.readFileSync(instanceIdPath, 'utf8')).trim()
    return t || null
  } catch {
    return null
  }
}
