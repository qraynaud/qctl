/**
 * Clone/pull the instance repo (hg). Deploy key from seed Tier-0 `DEPLOY_KEY`.
 */

import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { StageError } from '../errors.js'
import { decodeBootstrapBytes } from './lib/bootstrap.js'
import { detectQctlEnv, secretString } from './lib/credentials.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 * @returns {Promise<{ user: string, home: string, gid: string }>}
 */
async function resolveAdmin(ctx) {
  let user = ''
  if (existsSync('/etc/rocky/admin-user')) {
    user = (await readFile('/etc/rocky/admin-user', 'utf8')).trim()
  }
  if (!user) {
    const id = await ctx.exec(['id', '-u', 'rocky'])
    if (id.code === 0) user = 'rocky'
  }
  if (!user) throw new Error('no admin user (/etc/rocky/admin-user) — did admin-user run?')
  const homeR = await ctx.exec(['getent', 'passwd', user])
  if (homeR.code !== 0) throw new Error(`admin user '${user}' does not exist`)
  const home = homeR.stdout.split(':')[5] || ''
  if (!home || home === '/' || home === '/nonexistent') {
    throw new Error(`admin '${user}' has no usable home`)
  }
  const gidR = await ctx.exec(['id', '-g', user])
  if (gidR.code !== 0) throw new Error(`id -g ${user} failed`)
  return { user, home, gid: gidR.stdout.trim() }
}

/**
 * @param {StageContext} ctx
 * @param {string} user
 * @param {string[]} argv
 */
async function asAdmin(ctx, user, argv) {
  return ctx.exec(['runuser', '-u', user, '--', ...argv])
}

export default {
  name: 'hg-clone',
  describe: 'Clone/pull instance repo; deploy key from seed DEPLOY_KEY',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      `Tier-0 DEPLOY_KEY (QCTL_ENV=${detectQctlEnv(ctx.osConfig)})`,
      `hg clone/pull as admin into ${ctx.osConfig.root}`,
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('hg-clone', 'must run as root')

    const vcs = (ctx.osConfig.repo.vcs || 'hg').trim()
    if (vcs !== 'hg') {
      throw new StageError(
        'hg-clone',
        `repo.vcs=${vcs} is not supported by hg-clone (set repo.vcs: hg in provision)`,
      )
    }

    const repoDir = ctx.osConfig.root?.trim() || '/tank/rocky'
    const hgUrl = ctx.osConfig.repo.url?.trim() || 'ssh://git@heptapod.lsystems.fr/qraynaud/rocky'
    const hgBranch = ctx.osConfig.repo.branch?.trim() || ''
    const hgBin = ctx.paths.hgBin?.trim() || '/usr/local/bin/hg'
    const deployHost = ctx.paths.deploySshHost?.trim() || 'heptapod.lsystems.fr'

    try {
      const admin = await resolveAdmin(ctx)
      const deployKeyPath = join(admin.home, '.ssh', 'deploy_key')
      const sshConfig = ctx.paths.sshConfig?.trim() || join(admin.home, '.ssh', 'config')

      const hgVer = await ctx.exec([hgBin, 'version', '-q'])
      if (hgVer.code !== 0) {
        throw new Error(`hg not found at ${hgBin} (cloud-init pipx)`)
      }
      ctx.log(`rocky-hg: using hg: ${hgBin} (${hgVer.stdout.trim()})`)

      const deployRaw = secretString(ctx.secrets, 'DEPLOY_KEY')
      if (!deployRaw) {
        throw new Error(
          'DEPLOY_KEY empty — set provision repo.deploy_key (!env) so seed can inject Tier-0',
        )
      }
      const keyBuf = decodeBootstrapBytes(deployRaw)
      const keyText = keyBuf.toString('utf8')
      if (!/BEGIN .*PRIVATE KEY/.test(keyText)) {
        throw new Error('DEPLOY_KEY does not look like an OpenSSH/PEM private key')
      }

      await mkdir(join(admin.home, '.ssh'), { recursive: true })
      await chmod(join(admin.home, '.ssh'), 0o700)
      await writeFile(deployKeyPath, keyText.endsWith('\n') ? keyText : `${keyText}\n`, {
        mode: 0o600,
      })
      await chmod(deployKeyPath, 0o600)
      await ctx.exec([
        'chown',
        `${admin.user}:${admin.gid}`,
        join(admin.home, '.ssh'),
        deployKeyPath,
      ])
      await ctx.exec(['rm', '-f', '/root/.ssh/heptapod_deploy_key', '/root/.ssh/deploy_key'])
      ctx.log(`rocky-hg: wrote ${deployKeyPath} from DEPLOY_KEY (owner ${admin.user})`)

      // SSH config Host stanza
      let cfg = existsSync(sshConfig) ? await readFile(sshConfig, 'utf8') : ''
      if (!cfg.includes(`Host ${deployHost}`)) {
        cfg +=
          (cfg && !cfg.endsWith('\n') ? '\n' : '')
          + `Host ${deployHost}\n  IdentityFile ${deployKeyPath}\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n`
        await writeFile(sshConfig, cfg, { mode: 0o600 })
        await chmod(sshConfig, 0o600)
        await ctx.exec(['chown', `${admin.user}:${admin.gid}`, sshConfig])
        ctx.log(`rocky-hg: wrote ${sshConfig} (Host ${deployHost})`)
      }

      await mkdir(dirname(repoDir), { recursive: true })
      if (!existsSync(repoDir)) {
        await mkdir(repoDir, { recursive: true })
        await ctx.exec(['chown', `${admin.user}:${admin.gid}`, repoDir])
      } else {
        await ctx.exec(['chown', '-R', `${admin.user}:${admin.gid}`, repoDir])
      }

      if (existsSync(join(repoDir, '.hg'))) {
        ctx.log(`rocky-hg: repo already at ${repoDir} — pull -u as ${admin.user}`)
        const pull = await asAdmin(ctx, admin.user, [
          'bash',
          '-c',
          'cd "$1" && umask 022 && "$2" pull -u',
          '_',
          repoDir,
          hgBin,
        ])
        if (pull.code !== 0) {
          ctx.log('rocky-hg: pull -u failed (ignored; existing clone is enough)')
        }
        if (hgBranch) {
          const up = await asAdmin(ctx, admin.user, [
            hgBin,
            '-R',
            repoDir,
            'update',
            '-C',
            hgBranch,
          ])
          if (up.code !== 0) throw new Error(`hg update -C '${hgBranch}' failed`)
        }
      } else {
        // Refuse non-empty non-hg dir
        const ls = await ctx.exec(['bash', '-c', 'ls -A "$1" 2>/dev/null | head -1', '_', repoDir])
        if (ls.stdout.trim()) {
          throw new Error(`${repoDir} exists but is not an hg repo`)
        }
        const cloneArgs = hgBranch
          ? [hgBin, 'clone', '-u', hgBranch, hgUrl, repoDir]
          : [hgBin, 'clone', hgUrl, repoDir]
        ctx.log(
          `rocky-hg: clone ${hgUrl} → ${repoDir} as ${admin.user}`
            + (hgBranch ? ` (update ${hgBranch})` : ''),
        )
        const clone = await asAdmin(ctx, admin.user, [
          'bash',
          '-c',
          'umask 022; exec "$@"',
          '_',
          ...cloneArgs,
        ])
        if (clone.code !== 0) {
          throw new Error(
            `hg clone failed: ${clone.stderr || clone.stdout || `exit ${clone.code}`}`,
          )
        }
      }

      if (!existsSync(join(repoDir, '.hg'))) throw new Error(`no .hg at ${repoDir}`)
      const owner = await ctx.exec(['stat', '-c', '%U', repoDir])
      if (owner.stdout.trim() !== admin.user) {
        throw new Error(`${repoDir} owned by ${owner.stdout.trim()} (expected ${admin.user})`)
      }
      const id = await asAdmin(ctx, admin.user, [hgBin, '-R', repoDir, 'id', '-i'])
      ctx.log(`rocky-hg: repo OK: ${id.stdout.trim()} (owner ${admin.user})`)
      ctx.log(`rocky-hg: done (${repoDir} as ${admin.user})`)
    } catch (err) {
      throw new StageError('hg-clone', err instanceof Error ? err.message : String(err))
    }
  },
}
