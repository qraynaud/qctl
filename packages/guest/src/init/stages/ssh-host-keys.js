/**
 * Restore SSH host keys from seed Tier-0 `SSH_HOST_KEYS` (gzip tar, usually base64),
 * or generate fresh keys when empty.
 */
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { StageError } from '../errors.js'
import { decodeBootstrapBytes } from './lib/bootstrap.js'
import { detectQctlEnv, secretString } from './lib/credentials.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {StageContext} ctx
 */
async function ensureHostKeysOnDisk(ctx) {
  const r = await ctx.exec(['ssh-keygen', '-A'])
  if (r.code !== 0) {
    throw new Error(`ssh-keygen -A failed: ${r.stderr || r.stdout || `exit ${r.code}`}`)
  }
  const chmodScript = `
set -euo pipefail
for f in /etc/ssh/ssh_host_*_key; do
  [[ -f "$f" ]] || { echo "missing $f" >&2; exit 1; }
  chmod 0600 "$f"
done
for f in /etc/ssh/ssh_host_*.pub; do
  [[ -f "$f" ]] || continue
  chmod 0644 "$f"
done
`
  const c = await ctx.exec(['bash', '-c', chmodScript, 'ssh-host-keys-chmod'])
  if (c.code !== 0) throw new Error(c.stderr || c.stdout || `exit ${c.code}`)
}

/**
 * @param {StageContext} ctx
 * @param {Buffer} archive
 */
async function restoreFromArchive(ctx, archive) {
  const dir = await mkdtemp(join(tmpdir(), 'ssh-host-keys-'))
  const tarPath = join(dir, 'ssh-host-keys.tar.gz')
  await writeFile(tarPath, archive, { mode: 0o600 })
  const r = await ctx.exec(['tar', '-C', '/etc/ssh', '-xzf', tarPath])
  await ctx.exec(['rm', '-rf', dir])
  if (r.code !== 0) {
    throw new Error(`tar extract failed: ${r.stderr || r.stdout || `exit ${r.code}`}`)
  }
  await ensureHostKeysOnDisk(ctx)
  const names = await readdir('/etc/ssh')
  if (!names.some((n) => /^ssh_host_.*_key$/.test(n))) {
    throw new Error('archive had no ssh_host_*_key files')
  }
  ctx.log('rocky-ssh-host-keys: restored host keys into /etc/ssh from SSH_HOST_KEYS')
}

export default {
  name: 'ssh-host-keys',
  describe: 'Restore SSH host keys from seed SSH_HOST_KEYS, or generate local keys',
  /**
   * @param {StageContext} ctx
   */
  plan(ctx) {
    return [
      `Tier-0 SSH_HOST_KEYS (QCTL_ENV=${detectQctlEnv(ctx.osConfig)})`,
      'if SSH_HOST_KEYS set → extract into /etc/ssh; else ssh-keygen -A',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('ssh-host-keys', 'must run as root')

    await mkdir('/run/rocky', { recursive: true })
    await ensureHostKeysOnDisk(ctx)

    const raw = secretString(ctx.secrets, 'SSH_HOST_KEYS')
    if (!raw) {
      ctx.log(
        'rocky-ssh-host-keys: SSH_HOST_KEYS empty — keeping freshly generated host keys (set ssh.host_keys in provision to persist)',
      )
      return
    }

    try {
      const buf = decodeBootstrapBytes(raw)
      if (!buf.length) {
        ctx.log('rocky-ssh-host-keys: SSH_HOST_KEYS decoded empty — keeping local keys')
        return
      }
      await restoreFromArchive(ctx, buf)
    } catch (err) {
      ctx.log(
        `rocky-ssh-host-keys: WARN: could not restore SSH_HOST_KEYS — keeping local keys (${err instanceof Error ? err.message : String(err)})`,
      )
    }
  },
}
