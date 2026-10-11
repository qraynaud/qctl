/**
 * podman login from seed Tier-0 `ROCKY_REGISTRIES` (JSON array of
 * `registry|username|token` from provision `registries:`).
 */
import { StageError } from '../errors.js'
import { detectQctlEnv, envString } from './lib/credentials.js'

/** @import { StageContext } from '../context.js' */

/**
 * @param {string} raw
 * @param {string} label
 * @returns {{ registry: string, user: string, token: string } | null}
 */
export function parseContainerRegistryValue(raw, label = 'container-registry') {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (!s.includes('|') || s.indexOf('|') === s.lastIndexOf('|')) {
    throw new Error(`${label}: want registry|username|token (got ${JSON.stringify(raw)})`)
  }
  const registry = s.slice(0, s.indexOf('|')).trim()
  const rest = s.slice(s.indexOf('|') + 1)
  const user = rest.slice(0, rest.indexOf('|')).trim()
  const token = rest.slice(rest.indexOf('|') + 1).trim()
  if (!registry || !user || !token) {
    throw new Error(`${label}: empty registry, username, or token`)
  }
  return { registry, user, token }
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parseRegistriesJson(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return []
  try {
    const v = JSON.parse(s)
    if (!Array.isArray(v)) throw new Error('not an array')
    return v.map((x) => String(x ?? '').trim()).filter(Boolean)
  } catch (err) {
    throw new Error(
      `ROCKY_REGISTRIES: want JSON array of registry|user|token (${err instanceof Error ? err.message : String(err)})`,
    )
  }
}

/**
 * @param {StageContext} ctx
 * @param {string} registry
 * @param {string} user
 * @param {string} token
 */
async function podmanLoginRoot(ctx, registry, user, token) {
  const r = await ctx.exec([
    'bash',
    '-c',
    'printf %s "$1" | podman login --username "$2" --password-stdin "$3"',
    'podman-login',
    token,
    user,
    registry,
  ])
  if (r.code !== 0) {
    throw new Error(
      `podman login ${registry} (root) failed: ${r.stderr || r.stdout || `exit ${r.code}`}`,
    )
  }
}

/**
 * @param {StageContext} ctx
 * @param {string} registry
 * @param {string} user
 * @param {string} token
 * @param {string} quadletUser
 */
async function podmanLoginAsApps(ctx, registry, user, token, quadletUser) {
  const script = `
set -euo pipefail
u="$1"; registry="$2"; user="$3"; token="$4"
id "$u" &>/dev/null || { echo "rootless user '$u' missing" >&2; exit 1; }
uid=$(id -u "$u")
home="$(getent passwd "$u" | cut -d: -f6)"
rt="/run/user/\${uid}"
bus="\${rt}/bus"
systemctl start "user@\${uid}.service" 2>/dev/null || true
[[ -S "$bus" ]] || { echo "no user bus at $bus (linger $u?)" >&2; exit 1; }
cd "\${home:-/}" || cd /
printf %s "$token" | runuser -u "$u" -- env \\
  "XDG_RUNTIME_DIR=\${rt}" \\
  "DBUS_SESSION_BUS_ADDRESS=unix:path=\${bus}" \\
  "HOME=\${home:-/}" \\
  podman login --username "$user" --password-stdin "$registry"
`
  const r = await ctx.exec([
    'bash',
    '-c',
    script,
    'podman-login-apps',
    quadletUser,
    registry,
    user,
    token,
  ])
  if (r.code !== 0) {
    throw new Error(
      `podman login ${registry} (as ${quadletUser}) failed: ${r.stderr || r.stdout || `exit ${r.code}`}`,
    )
  }
}

export default {
  name: 'registry-login',
  describe: 'podman login from seed ROCKY_REGISTRIES (provision registries:)',
  /**
   * @param {StageContext} ctx
   * @returns {string[]}
   */
  plan(ctx) {
    return [
      `Tier-0 ROCKY_REGISTRIES (QCTL_ENV=${detectQctlEnv(ctx.env)})`,
      'each registry|user|token → podman login (root + apps)',
    ]
  },
  /**
   * @param {StageContext} ctx
   */
  async run(ctx) {
    if (!ctx.isRoot()) throw new StageError('registry-login', 'must run as root')

    let lines
    try {
      lines = parseRegistriesJson(envString(ctx.env, 'ROCKY_REGISTRIES'))
    } catch (err) {
      throw new StageError('registry-login', err instanceof Error ? err.message : String(err))
    }
    if (!lines.length) {
      ctx.log('rocky-registry: no ROCKY_REGISTRIES — skip')
      return
    }

    const appsUser = ctx.env.ROCKY_QUADLET_USER?.trim() || 'apps'
    let n = 0
    for (let i = 0; i < lines.length; i++) {
      const label = `registries[${i}]`
      let parsed
      try {
        parsed = parseContainerRegistryValue(lines[i], label)
      } catch (err) {
        throw new StageError('registry-login', err instanceof Error ? err.message : String(err))
      }
      if (!parsed) continue
      ctx.log(`rocky-registry: podman login ${parsed.registry} (root + ${appsUser}) [${label}]`)
      try {
        await podmanLoginRoot(ctx, parsed.registry, parsed.user, parsed.token)
        await podmanLoginAsApps(ctx, parsed.registry, parsed.user, parsed.token, appsUser)
      } catch (err) {
        throw new StageError('registry-login', err instanceof Error ? err.message : String(err))
      }
      n += 1
    }
    if (n === 0) {
      ctx.log('rocky-registry: all registry values empty — skip')
    } else {
      ctx.log(`rocky-registry: registered ${n} container registry(ies)`)
    }
  },
}
