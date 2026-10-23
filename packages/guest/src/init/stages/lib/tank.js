/**
 * Shared ZFS tank helpers (JS).
 * Encrypted pool keys: Tier-0 `tank_passphrase_<poolId>` → credstore file.
 */
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { dirname } from 'node:path'

import { tankPassphraseCredName } from '@qctl/shared'

import { StageError } from '../../errors.js'
import { envString } from './credentials.js'

/** @import { StageContext } from '../../context.js' */

export const POOL_DEFAULT = 'tank'
export const MOUNT_DEFAULT = '/tank'
export const CREDSTORE_DEFAULT = '/etc/credstore/rocky'

/**
 * @param {StageContext} ctx
 * @param {string} [poolId]
 */
export function tankPool(ctx, poolId) {
  if (poolId?.trim()) return poolId.trim()
  // Host init-tank sets ROCKY_ZFS_POOL / ROCKY_INIT_TANK_POOLS via seed env.
  const fromList = ctx.env.ROCKY_INIT_TANK_POOLS?.trim()?.split(',')[0]?.trim()
  return ctx.env.ROCKY_ZFS_POOL?.trim() || fromList || POOL_DEFAULT
}

/**
 * @param {StageContext} ctx
 * @param {string} [mount]
 */
export function tankMount(ctx, mount) {
  if (mount?.trim()) return mount.trim()
  return ctx.env.ROCKY_TANK_MOUNT?.trim() || MOUNT_DEFAULT
}

/**
 * Credstore path for a pool (`tank_passphrase_<poolId>`).
 * @param {StageContext} ctx
 * @param {string} [poolId]
 */
export function tankCredFile(ctx, poolId) {
  if (ctx.env.ROCKY_TANK_CRED_FILE?.trim()) return ctx.env.ROCKY_TANK_CRED_FILE.trim()
  const dir = ctx.env.ROCKY_CREDSTORE_DIR?.trim() || CREDSTORE_DEFAULT
  const id = poolId?.trim() || tankPool(ctx)
  if (ctx.env.ROCKY_TANK_CRED_NAME?.trim()) {
    return `${dir}/${ctx.env.ROCKY_TANK_CRED_NAME.trim()}`
  }
  return `${dir}/${tankPassphraseCredName(id)}`
}

/**
 * @param {StageContext} ctx
 * @param {string} [poolId]
 */
export function tankKeyLocation(ctx, poolId) {
  if (ctx.env.ROCKY_TANK_KEYLOCATION?.trim()) return ctx.env.ROCKY_TANK_KEYLOCATION.trim()
  return `file://${tankCredFile(ctx, poolId)}`
}

/**
 * @param {StageContext} ctx
 * @param {string} [mount]
 */
export function tankCanary(ctx, mount) {
  if (ctx.env.ROCKY_TANK_CANARY?.trim()) return ctx.env.ROCKY_TANK_CANARY.trim()
  return `${tankMount(ctx, mount)}/.rocky-canary`
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
 * @param {string} [poolId]
 */
export async function installTankPassphrase(ctx, pass, poolId) {
  const credFile = tankCredFile(ctx, poolId)
  if (!pass) throw new Error('empty tank passphrase')
  await fsp.mkdir(dirname(credFile), { recursive: true })
  await fsp.writeFile(credFile, pass, { mode: 0o400 })
  await fsp.chmod(credFile, 0o400)
  ctx.log(`tank: installed key file ${credFile} (${tankKeyLocation(ctx, poolId)})`)
  return credFile
}

/**
 * Ensure the ZFS key file exists, reseeding from Tier-0 `tank_passphrase_<poolId>`.
 * @param {StageContext} ctx
 * @param {string} stageName
 * @param {string} [poolId]
 */
export async function ensureTankPassphraseFromBootstrap(ctx, stageName, poolId) {
  const id = poolId?.trim() || tankPool(ctx)
  const credFile = tankCredFile(ctx, id)
  if (fs.existsSync(credFile) && (await fsp.readFile(credFile, 'utf8')).trim()) {
    ctx.log(`tank: key already present at ${credFile}`)
    return credFile
  }
  const envKey = tankPassphraseCredName(id)
  const pass = envString(ctx.env, envKey)
  if (!pass) {
    throw new StageError(
      stageName,
      `${envKey} empty — set disks.tanks.${id}.passphrase (!env) so seed can inject Tier-0`,
    )
  }
  try {
    await installTankPassphrase(ctx, pass, id)
  } catch (err) {
    throw new StageError(stageName, err instanceof Error ? err.message : String(err))
  }
  return credFile
}

/**
 * @param {StageContext} ctx
 * @param {string} [poolId]
 */
export async function tankPoolImported(ctx, poolId) {
  const pool = tankPool(ctx, poolId)
  const r = await ctx.exec(['zpool', 'list', '-H', '-o', 'name', pool])
  return r.code === 0
}

/**
 * @param {StageContext} ctx
 * @param {string} [poolId]
 */
export async function tankPoolImportable(ctx, poolId) {
  const pool = tankPool(ctx, poolId)
  const r = await ctx.exec(['zpool', 'import'])
  if (r.code !== 0 && !r.stdout && !r.stderr) return false
  const re = new RegExp(`^\\s*${pool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm')
  return re.test(r.stdout || '') || re.test(r.stderr || '')
}

/**
 * @param {StageContext} ctx
 * @param {string} [poolId]
 */
export async function tankEnsureKeyLoaded(ctx, poolId) {
  const pool = tankPool(ctx, poolId)
  const credFile = tankCredFile(ctx, poolId)
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
  if (!fs.existsSync(credFile) || !(await fsp.readFile(credFile, 'utf8')).trim()) {
    throw new Error(
      `missing ${credFile} (re-seed from bootstrap ${tankPassphraseCredName(pool)} before load-key)`,
    )
  }
  await mustExec(ctx, ['zfs', 'load-key', pool], `zfs load-key ${pool}`)
  ctx.log(`tank: key loaded for ${pool} from ${credFile}`)
}

/**
 * Refuse rootfs placeholders: require VFS mount is zfs and `zfs get mounted=yes`.
 * `zfs mount` can exit 0 without attaching the dataset — do not trust that alone.
 *
 * @param {StageContext} ctx
 * @param {string} [poolId]
 * @param {string} [mountPath]
 */
export async function tankAssertZfsMounted(ctx, poolId, mountPath) {
  const pool = tankPool(ctx, poolId)
  const mount = tankMount(ctx, mountPath)

  const find = await ctx.exec(['findmnt', '-n', '-o', 'FSTYPE,SOURCE,TARGET', mount])
  if (find.code !== 0 || !find.stdout.trim()) {
    throw new Error(
      `${mount} is not a mountpoint (pool ${pool} may be unlocked but not attached — `
        + `refusing to treat a rootfs directory as the tank)`,
    )
  }
  const [fstype, source] = find.stdout.trim().split(/\s+/)
  if (fstype !== 'zfs') {
    throw new Error(
      `${mount} is mounted as ${fstype || '?'} (${source || '?'}) — want fstype=zfs for pool ${pool}`,
    )
  }

  const zMounted = await ctx.exec(['zfs', 'get', '-H', '-o', 'value', 'mounted', pool])
  const mountedVal = (zMounted.stdout || '').trim()
  if (mountedVal !== 'yes') {
    throw new Error(
      `zfs get mounted ${pool} = ${JSON.stringify(mountedVal)} (want "yes") `
        + `even though findmnt shows ${find.stdout.trim()}`,
    )
  }
}

/**
 * Mount via `zfs` and require {@link tankAssertZfsMounted}.
 * Retries: after export/import, systemd may still be Unmounting the generator
 * unit while `zfs mount` races (findmnt can briefly show zfs while
 * `zfs get mounted` is still `no`).
 *
 * @param {StageContext} ctx
 * @param {string} [poolId]
 * @param {string} [mountPath]
 */
export async function tankEnsureMounted(ctx, poolId, mountPath) {
  const pool = tankPool(ctx, poolId)
  const mount = tankMount(ctx, mountPath)
  const unit = await tankMountUnit(ctx, mount)
  const attemptsRaw = Number(ctx.env.ROCKY_TANK_MOUNT_ATTEMPTS)
  const attempts = Number.isFinite(attemptsRaw) && attemptsRaw >= 1 ? Math.floor(attemptsRaw) : 20
  const delayRaw = Number(ctx.env.ROCKY_TANK_MOUNT_RETRY_MS)
  const delayMs = Number.isFinite(delayRaw) ? Math.max(0, delayRaw) : 250
  /** @type {Error | null} */
  let lastErr = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await ctx.exec(['zfs', 'mount', '-a'])
      const find = await ctx.exec(['findmnt', '-n', mount])
      if (find.code !== 0) {
        const m = await ctx.exec(['zfs', 'mount', pool])
        if (m.code !== 0) {
          throw new Error(`zfs mount ${pool}: ${m.stderr || m.stdout || `exit ${m.code}`}`)
        }
      }
      await tankAssertZfsMounted(ctx, pool, mount)
      return
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      ctx.log(`tank: mount not settled (${lastErr.message}) — retry ${attempt + 1}/${attempts}`)
      // Drop generator ownership so a late Unmounting cannot fight us.
      await ctx.exec(['systemctl', 'stop', unit])
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr || new Error(`${mount} not mounted`)
}

/**
 * systemd unit for a tank mountpoint (`/tank` → `tank.mount`).
 * @param {StageContext} ctx
 * @param {string} [mountPath]
 * @returns {Promise<string>}
 */
export async function tankMountUnit(ctx, mountPath) {
  const mount = tankMount(ctx, mountPath)
  const esc = await ctx.exec(['systemd-escape', '--path', '--suffix=mount', mount])
  if (esc.code === 0 && esc.stdout.trim()) return esc.stdout.trim()
  // Fallback for odd environments without systemd-escape.
  return `${mount.replace(/^\//, '').replace(/\//g, '-')}.mount`
}

/**
 * After `zfs mount`, sync systemd so the mount unit stays active.
 * @param {StageContext} ctx
 * @param {string} [poolId]
 * @param {string} [mountPath]
 */
export async function tankEnsureSystemdMount(ctx, poolId, mountPath) {
  const pool = tankPool(ctx, poolId)
  const unit = await tankMountUnit(ctx, mountPath)
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
 * @param {string} [poolId]
 * @param {string} [mountPath]
 */
export async function tankImportPool(ctx, poolId, mountPath) {
  const pool = tankPool(ctx, poolId)
  const mount = tankMount(ctx, mountPath)
  const unit = await tankMountUnit(ctx, mount)
  ctx.log(`tank: importing ${pool}`)
  // Keep generator units quiet until zfs mount has settled (avoids Unmounting races).
  await ctx.exec(['systemctl', 'stop', unit])
  await ctx.exec(['systemctl', 'stop', `zfs-load-key@${pool}.service`])
  const byId = await ctx.exec(['zpool', 'import', '-d', '/dev/disk/by-id', pool])
  if (byId.code !== 0) {
    await mustExec(ctx, ['zpool', 'import', pool], `zpool import ${pool}`)
  }
  await tankEnsureKeyLoaded(ctx, pool)
  await tankEnsureMounted(ctx, pool, mount)
  await tankEnsureSystemdMount(ctx, pool, mount)
}

/**
 * Prepare zfs-list.cache for zfs-mount-generator (next boot unlock).
 * @param {StageContext} ctx
 * @param {string} [poolId]
 * @param {string} [mountPath]
 */
export async function tankEnableBootUnlock(ctx, poolId, mountPath) {
  const pool = tankPool(ctx, poolId)
  const cacheDir = ctx.env.ROCKY_ZFS_LIST_CACHE_DIR?.trim() || '/etc/zfs/zfs-list.cache'
  const cache = `${cacheDir}/${pool}`
  await fsp.mkdir(cacheDir, { recursive: true })
  if (!fs.existsSync(cache)) {
    await fsp.writeFile(cache, '', { mode: 0o644 })
    ctx.log(`tank: created ${cache} for zfs-mount-generator`)
  }
  await ctx.exec(['systemctl', 'enable', 'zfs-zed.service'])
  await ctx.exec(['systemctl', 'start', 'zfs-zed.service'])
  if (await tankPoolImported(ctx, pool)) {
    await ctx.exec(['zfs', 'list', '-H', '-o', 'name', pool])
    // Property change → history_event-zfs-list-cacher.sh (via zed) fills the cache.
    const cm = await ctx.exec(['zfs', 'get', '-H', '-o', 'value', 'canmount', pool])
    const canmount = cm.stdout.trim() || 'on'
    await ctx.exec(['zfs', 'set', `canmount=${canmount}`, pool])
    // Nudge once more if zed is slow (toggle org.rocky:cache-stamp).
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(cache) && (await fsp.readFile(cache, 'utf8')).trim()) break
      if (i === 5) {
        await ctx.exec(['zfs', 'set', `org.rocky:cache-stamp=${Date.now()}`, pool])
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!fs.existsSync(cache) || !(await fsp.readFile(cache, 'utf8')).trim()) {
    ctx.log(
      `tank: warn: ${cache} still empty — generator may not emit zfs-load-key@${pool} until next property change`,
    )
  } else {
    const bytes = (await fsp.readFile(cache)).length
    ctx.log(`tank: zfs-list.cache ready (${bytes} bytes) → zfs-load-key@${pool} on next boot`)
  }
  await ctx.exec(['systemctl', 'daemon-reload'])
  await tankEnsureSystemdMount(ctx, pool, mountPath)
}

/**
 * @param {StageContext} ctx
 * @param {string} [path]
 * @param {string} [mountPath]
 */
export async function writeTankCanary(ctx, path, mountPath) {
  const canary = path || tankCanary(ctx, mountPath)
  await fsp.mkdir(dirname(canary), { recursive: true })
  const line = `rocky tank canary ${new Date().toISOString()}\n`
  await fsp.writeFile(canary, line, { mode: 0o644 })
  await ctx.exec(['sync', canary])
  ctx.log(`tank: canary → ${canary}`)
  return canary
}
