/**
 * On install, rewrite author-friendly `peer.service` → `qctl-app@peer.service`
 * only when the peer app runs on the other engine (rootful ↔ rootless).
 * Same-engine peers stay as `peer.service`. Source templates stay unrewritten.
 */
import { DEP_LINE_RE, qctlAppProxyUnit, serviceTokenToApp } from './dep-keys.js'
import { appDir, readEngine } from './discovery.js'

/** @import { Engine } from '../system.js' */

/**
 * Rewrite cross-engine app peer tokens to `qctl-app@<app>.service`.
 * Leaves same-engine peers, targets, timers, unknown services, and
 * already-rewritten tokens alone.
 *
 * @param {string} content rendered unit text
 * @param {{ root: string }} ctx
 * @param {Engine} dependentEngine engine of the app being installed
 * @returns {string}
 */
export function rewritePeerServiceDeps(content, ctx, dependentEngine) {
  const lines = content.split('\n')
  let changed = false
  const out = lines.map((line) => {
    const m = DEP_LINE_RE.exec(line)
    if (!m) return line
    const key = m[1]
    const rhs = m[2] ?? ''
    const hash = rhs.indexOf('#')
    const valPart = hash >= 0 ? rhs.slice(0, hash) : rhs
    const comment = hash >= 0 ? rhs.slice(hash).replace(/^\s*/, '') : ''
    const trailingWs = (valPart.match(/\s+$/) ?? [''])[0]
    const tokens = valPart.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return line
    let lineChanged = false
    const next = tokens.map((tok) => {
      if (tok.startsWith('qctl-app@')) return tok
      const app = serviceTokenToApp(tok)
      if (!app) return tok
      const dir = appDir(ctx, app)
      if (!dir) return tok
      if (readEngine(dir) === dependentEngine) return tok
      lineChanged = true
      return qctlAppProxyUnit(app)
    })
    if (!lineChanged) return line
    changed = true
    const spacing = comment ? trailingWs || ' ' : ''
    return `${key}=${next.join(' ')}${comment ? spacing + comment : ''}`
  })
  return changed ? out.join('\n') : content
}
