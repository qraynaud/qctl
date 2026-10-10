/**
 * Seal pending Tier-0 credentials into /etc/credstore.encrypted (idempotent).
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { StageError } from '../errors.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listCredNames(dir) {
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  return names.filter((n) => n && !n.startsWith('.'))
}

/**
 * @param {StageContext} ctx
 * @param {string} path
 */
async function shredOrRm(ctx, path) {
  const shred = await ctx.exec(['bash', '-c', 'command -v shred'])
  if (shred.code === 0) {
    await ctx.exec(['shred', '-u', path])
  } else {
    await unlink(path).catch(() => {})
  }
}

export default {
  name: 'tier0-seal',
  describe: 'Seal pending Tier-0 credentials into /etc/credstore.encrypted (idempotent)',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    const pending = ctx.env.ROCKY_TIER0_PENDING?.trim() || '/var/lib/rocky/tier0-pending'
    const enc = ctx.env.ROCKY_TIER0_ENCRYPTED?.trim() || '/etc/credstore.encrypted'
    return [`seal ${pending}/* → ${enc}/* via systemd-creds --with-key=auto`]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('tier0-seal', 'must run as root')

    const pendingDir = ctx.env.ROCKY_TIER0_PENDING?.trim() || '/var/lib/rocky/tier0-pending'
    const encDir = ctx.env.ROCKY_TIER0_ENCRYPTED?.trim() || '/etc/credstore.encrypted'

    try {
      const names = new Set([
        ...(await listCredNames(pendingDir)),
        ...(await listCredNames(encDir)),
      ])

      if (names.size === 0) {
        ctx.log('rocky-tier0-seal: no Tier-0 pending or sealed credentials — nothing to seal')
        return
      }

      await mkdir(encDir, { recursive: true })
      await chmod(encDir, 0o755)
      await ctx.exec(['systemd-creds', 'setup'])

      let sealed = 0
      for (const name of names) {
        const enc = join(encDir, name)
        const pending = join(pendingDir, name)
        const encFile = Bun.file(enc)
        if ((await encFile.exists()) && encFile.size > 0) {
          ctx.log(`rocky-tier0-seal: ${name} already sealed at ${enc}`)
          await unlink(pending).catch(() => {})
          continue
        }
        const pendingFile = Bun.file(pending)
        if (!(await pendingFile.exists()) || pendingFile.size === 0) {
          throw new Error(`missing pending Tier-0 file ${pending} (and no encrypted ${enc})`)
        }
        ctx.log(`rocky-tier0-seal: encrypting ${name} → ${enc} (--with-key=auto)`)
        const r = await ctx.exec([
          'systemd-creds',
          'encrypt',
          `--name=${name}`,
          '--with-key=auto',
          pending,
          enc,
        ])
        if (r.code !== 0) {
          throw new Error(`systemd-creds encrypt ${name} failed: ${r.stderr.trim()}`)
        }
        await chmod(enc, 0o400)
        await shredOrRm(ctx, pending)
        sealed++
      }

      if (existsSync(pendingDir)) {
        await rm(pendingDir, { recursive: true, force: true })
      }

      if (sealed) {
        ctx.log(`rocky-tier0-seal: Tier-0 sealed into ${encDir} (plaintext pending removed)`)
      } else {
        ctx.log('rocky-tier0-seal: Tier-0 already sealed; nothing to do')
      }
    } catch (err) {
      throw new StageError('tier0-seal', err instanceof Error ? err.message : String(err))
    }
  },
}
