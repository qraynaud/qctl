/**
 * Embed guest tooling into the NoCloud seed ISO (cidata qctl-guest/).
 */
import { chalk, fs, path } from 'zx'

import { ensureGuestTooling } from '../../../tooling/guest-tooling.js'

/**
 * Stage guest tooling into the cidata dir under `qctl-guest/`.
 * Prefer `QCTL_GUEST_DIST`, else checkout `dist/` when running from a qctl repo,
 * else GitHub release assets (`qctl.platform` / host version).
 * First-boot secrets come from provision YAML → Tier-0 pending.
 *
 * @param {string} stageDir temporary cidata directory
 * @param {{
 *   platformModule?: string,
 *   env?: string,
 *   target?: string,
 *   platform?: string,
 * }} [opts]
 * @returns {Promise<string[]>} basenames of the primary binaries copied (`qctl-guest` when present)
 */
export async function embedGuestTooling(stageDir, opts = {}) {
  const dest = path.join(stageDir, 'qctl-guest')
  await fs.mkdirp(dest)

  const resolved = await ensureGuestTooling({
    env: opts.env,
    target: opts.target,
    platform: opts.platform,
    platformModule: opts.platformModule,
    // Soft-fail only when an explicit local dist override is incomplete (tests / dry paths).
    required: !process.env.QCTL_GUEST_DIST?.trim(),
  })
  if (!resolved) return []

  await fs.copyFile(resolved.guestPath, path.join(dest, 'qctl-guest'))
  await fs.chmod(path.join(dest, 'qctl-guest'), 0o755)

  await fs.copyFile(resolved.platformModulePath, path.join(dest, resolved.platformModule))
  await fs.chmod(path.join(dest, resolved.platformModule), 0o644)

  /** @type {string[]} */
  const extras = [resolved.platformModule]
  if (resolved.encryptPath) {
    await fs.copyFile(resolved.encryptPath, path.join(dest, 'varlock-local-encrypt'))
    await fs.chmod(path.join(dest, 'varlock-local-encrypt'), 0o755)
    extras.push('varlock-local-encrypt')
  }

  console.log(chalk.dim(`  guest tooling: qctl-guest ← ${resolved.sourceLabel}`))
  console.log(chalk.dim(`  guest extras: ${extras.join(', ')}`))
  return ['qctl-guest']
}
