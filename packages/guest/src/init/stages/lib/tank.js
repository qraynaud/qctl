/**
 * Shared ZFS tank helpers (JS). Pool key file SoT is seed Tier-0 `TANK_PASSPHRASE`.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { StageError } from '../../errors.js'
import { envString } from './credentials.js'

/** @import { StageContext } from '../../context.js' */

export const POOL_DEFAULT = 'tank'
export const MOUNT_DEFAULT = '/tank'
export const CREDSTORE_DEFAULT = '/etc/credstore/rocky'
export const CRED_NAME_DEFAULT = 'tank_passphrase'

/**
 * @param {StageContext} ctx
 */
export function tankPool(ctx) {
  return ctx.env.ROCKY_ZFS_POOL?.trim() || POOL_DEFAULT
}

/**
 * @param {StageContext} ctx
 */
export function tankMount(ctx) {
  return ctx.env.ROCKY_TANK_MOUNT?.trim() || MOUNT_DEFAULT
}

/**
 * @param {StageContext} ctx
 */
export function tankCredFile(ctx) {
  if (ctx.env.ROCKY_TANK_CRED_FILE?.trim()) return ctx.env.ROCKY_TANK_CRED_FILE.trim()
  const dir = ctx.env.ROCKY_CREDSTORE_DIR?.trim() || CREDSTORE_DEFAULT
  const name = ctx.env.ROCKY_TANK_CRED_NAME?.trim() || CRED_NAME_DEFAULT
  return `${dir}/${name}`
}

/**
 * @param {StageContext} ctx
 */
export function tankKeyLocation(ctx) {
  return ctx.env.ROCKY_TANK_KEYLOCATION?.trim() || `file://${tankCredFile(ctx)}`
}

/**
 * @param {StageContext} ctx
 */
export function tankCanary(ctx) {
  return ctx.env.ROCKY_TANK_CANARY?.trim() || `${tankMount(ctx)}/.rocky-canary`
}

/**
 * @param {StageContext} ctx
 * @param {string[]} argv
 * @param {string} errPrefix
 */
export async function mustExec(ctx, argv, errPrefix) {
  const r = await ctx.exec(argv)
  if (r.code !== 0) {
    throw new Error(`${errPrefix}: ${r.stderr || r.stdout || `exit ${r.code}`}`)
  }
  return r
}

/**
 * @param {StageContext} ctx
 * @param {string} pass
 */
export async function installTankPassphrase(ctx, pass) {
  const credFile = tankCredFile(ctx)
  if (!pass) throw new Error('empty tank passphrase')
  await mkdir(dirname(credFile), { recursive: true })
  await writeFile(credFile, pass, { mode: 0o400 })
  await chmod(credFile, 0o400)
  ctx.log(`tank: installed key file ${credFile} (${tankKeyLocation(ctx)})`)
  return credFile
}

/**
 * Ensure the ZFS key file exists, reseeding from Tier-0 / env `TANK_PASSPHRASE` when missing.
 * @param {StageContext} ctx
 * @param {string} stageName
 */
export async function ensureTankPassphraseFromBootstrap(ctx, stageName) {
  const credFile = tankCredFile(ctx)
  if (existsSync(credFile) && (await readFile(credFile, 'utf8')).trim()) {
    ctx.log(`tank: key already present at ${credFile}`)
    return credFile
  }
  const pass = envString(ctx.env, 'TANK_PASSPHRASE')
  if (!pass) {
    throw new StageError(
      stageName,
      'TANK_PASSPHRASE empty — set provision tank.passphrase (!env) so seed can inject Tier-0',
    )
  }
  try {
    await installTankPassphrase(ctx, pass)
  } catch (err) {
    throw new StageError(stageName, err instanceof Error ? err.message : String(err))
  }
  return credFile
}

/**
 * @param {StageContext} ctx
 */
export async function tankPoolImported(ctx) {
  const pool = tankPool(ctx)
  const r = await ctx.exec(['zpool', 'list', '-H', '-o', 'name', pool])
  return r.code === 0
}

/**
 * @param {StageContext} ctx
 */
export async function tankPoolImportable(ctx) {
  const pool = tankPool(ctx)
  const r = await ctx.exec(['zpool', 'import'])
  if (r.code !== 0 && !r.stdout && !r.stderr) return false
  const re = new RegExp(`^\\s*${pool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm')
  return re.test(r.stdout || '') || re.test(r.stderr || '')
}

/**
 * @param {StageContext} ctx
 */
export async function tankEnsureKeyLoaded(ctx) {
  const pool = tankPool(ctx)
  const credFile = tankCredFile(ctx)
  const enc = await ctx.exec(['zfs', 'get', '-H', '-o', 'value', 'encryption', pool])
  const encVal = (enc.stdout || 'off').trim() || 'off'
  if (encVal === 'off' || encVal === '-') {
    ctx.log(`tank: pool ${pool} encryption=${encVal}`)
    return
  }
  const status = await ctx.exec(['zfs', 'get', '-H', '-o', 'value', 'keystatus', pool])
  if (status.stdout.trim() === 'available') {
    ctx.log('tank: key already loaded')
    return
  }
  if (!existsSync(credFile) || !(await readFile(credFile, 'utf8')).trim()) {
    throw new Error(`missing ${credFile} (re-seed from bootstrap TANK_PASSPHRASE before load-key)`)
  }
  await mustExec(ctx, ['zfs', 'load-key', pool], `zfs load-key ${pool}`)
  ctx.log(`tank: key loaded for ${pool} from ${credFile}`)
}

/**
 * @param {StageContext} ctx
 */
export async function tankEnsureMounted(ctx) {
  const pool = tankPool(ctx)
  const mount = tankMount(ctx)
  await ctx.exec(['zfs', 'mount', '-a'])
  let mounted = await ctx.exec(['findmnt', '-n', mount])
  if (mounted.code !== 0) {
    await ctx.exec(['zfs', 'mount', pool])
    mounted = await ctx.exec(['findmnt', '-n', mount])
  }
  if (mounted.code !== 0) throw new Error(`${mount} not mounted`)
}

/**
 * systemd unit for the tank mountpoint (`/tank` → `tank.mount`).
 * @param {StageContext} ctx
 * @returns {Promise<string>}
 */
export async function tankMountUnit(ctx) {
  const mount = tankMount(ctx)
  const esc = await ctx.exec(['systemd-escape', '--path', '--suffix=mount', mount])
  if (esc.code === 0 && esc.stdout.trim()) return esc.stdout.trim()
  // Fallback for odd environments without systemd-escape.
  return `${mount.replace(/^\//, '').replace(/\//g, '-')}.mount`
}

/**
 * After `zfs mount`, sync systemd so `tank.mount` stays active (zfs-drill stops it
 * for export; a bare `zfs mount` does not reactivate the unit).
 * @param {StageContext} ctx
 */
export async function tankEnsureSystemdMount(ctx) {
  const pool = tankPool(ctx)
  const unit = await tankMountUnit(ctx)
  await ctx.exec(['systemctl', 'daemon-reload'])
  await ctx.exec(['systemctl', 'start', `zfs-load-key@${pool}.service`])
  const start = await ctx.exec(['systemctl', 'start', unit])
  if (start.code !== 0) {
    ctx.log(
      `tank: warn: systemctl start ${unit} failed (generator unit may be missing yet): ${
        start.stderr || start.stdout || `exit ${start.code}`
      }`,
    )
    return
  }
  ctx.log(`tank: systemd ${unit} active`)
}

/**
 * @param {StageContext} ctx
 */
export async function tankImportPool(ctx) {
  const pool = tankPool(ctx)
  ctx.log(`tank: importing ${pool}`)
  const byId = await ctx.exec(['zpool', 'import', '-d', '/dev/disk/by-id', pool])
  if (byId.code !== 0) {
    await mustExec(ctx, ['zpool', 'import', pool], `zpool import ${pool}`)
  }
  await tankEnsureKeyLoaded(ctx)
  await tankEnsureMounted(ctx)
  await tankEnsureSystemdMount(ctx)
}

/**
 * Prepare zfs-list.cache for zfs-mount-generator (next boot unlock).
 * @param {StageContext} ctx
 */
export async function tankEnableBootUnlock(ctx) {
  const pool = tankPool(ctx)
  const cache = `/etc/zfs/zfs-list.cache/${pool}`
  await mkdir('/etc/zfs/zfs-list.cache', { recursive: true })
  if (!existsSync(cache)) {
    await writeFile(cache, '', { mode: 0o644 })
    ctx.log(`tank: created ${cache} for zfs-mount-generator`)
  }
  await ctx.exec(['systemctl', 'enable', 'zfs-zed.service'])
  await ctx.exec(['systemctl', 'start', 'zfs-zed.service'])
  if (await tankPoolImported(ctx)) {
    await ctx.exec(['zfs', 'list', '-H', '-o', 'name', pool])
    // Property change → history_event-zfs-list-cacher.sh (via zed) fills the cache.
    const cm = await ctx.exec(['zfs', 'get', '-H', '-o', 'value', 'canmount', pool])
    const canmount = cm.stdout.trim() || 'on'
    await ctx.exec(['zfs', 'set', `canmount=${canmount}`, pool])
    // Nudge once more if zed is slow (toggle org.rocky:cache-stamp).
    for (let i = 0; i < 20; i++) {
      if (existsSync(cache) && (await readFile(cache, 'utf8')).trim()) break
      if (i === 5) {
        await ctx.exec(['zfs', 'set', `org.rocky:cache-stamp=${Date.now()}`, pool])
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!existsSync(cache) || !(await readFile(cache, 'utf8')).trim()) {
    ctx.log(
      `tank: warn: ${cache} still empty — generator may not emit zfs-load-key@${pool} until next property change`,
    )
  } else {
    const bytes = (await readFile(cache)).length
    ctx.log(`tank: zfs-list.cache ready (${bytes} bytes) → zfs-load-key@${pool} on next boot`)
  }
  await ctx.exec(['systemctl', 'daemon-reload'])
  await tankEnsureSystemdMount(ctx)
}

/**
 * @param {StageContext} ctx
 * @param {string} [path]
 */
export async function writeTankCanary(ctx, path) {
  const canary = path || tankCanary(ctx)
  await mkdir(dirname(canary), { recursive: true })
  const line = `rocky tank canary ${new Date().toISOString()}\n`
  await writeFile(canary, line, { mode: 0o644 })
  await ctx.exec(['sync', canary])
  ctx.log(`tank: canary → ${canary}`)
  return canary
}
