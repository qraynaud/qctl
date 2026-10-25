/**
 * `qctl secret check`: compare graph-resolved `@sensitive` values to Podman secrets
 * (via `qctl.sha256` labels written by `secret sync`). Exit 1 on drift.
 */
import { tryReadOsConfig } from '../os-config.js'
import { detectQctlEnvFor } from '../supervisor/quadlet/env.js'
import { secretNamesConsumedByApp } from './consumers.js'
import { SECRET_HASH_LABEL, secretContentHash } from './hash.js'
import {
  defaultPodman,
  podmanSecretName,
  readSecretHash,
  schemaDirIsCommon,
  schemaDirIsRootful,
  schemaDirsForSync,
} from './sync.js'
import { loadSensitiveItems } from './varlock.js'
/** @import { Engine, PodmanRunner } from './sync.js' */

/**
 * @typedef {object} CheckRow
 * @property {string} name
 * @property {string} key
 * @property {Engine} engine
 * @property {'match' | 'mismatch' | 'missing' | 'unlabeled' | 'skipped'} status
 * @property {string} [detail]
 */

/**
 * @typedef {object} CheckOptions
 * @property {string} root
 * @property {string} [app] scope to one app (+ common secrets it `Secret=`s)
 * @property {boolean} [rootlessOnly] skip rootful stores (apps-socket Pre)
 * @property {string} [qctlEnv]
 * @property {string} [quadletUser]
 * @property {Record<string, string | undefined>} [env]
 * @property {number} [uid]
 * @property {PodmanRunner} [podman]
 * @property {(msg: string) => void} [log]
 */

/**
 * @param {CheckOptions} o
 * @returns {Promise<{ ok: boolean, rows: CheckRow[], qctlEnv: string }>}
 */
export async function runSecretCheck(o) {
  const env = o.env ?? process.env
  const uid = o.uid ?? process.getuid?.() ?? 0
  const log = o.log ?? ((m) => console.log(`secret-check: ${m}`))
  const os = tryReadOsConfig()
  const podman = o.podman ?? defaultPodman(uid, o.quadletUser ?? os?.quadletUser ?? 'apps')
  const qctlEnv = o.qctlEnv ?? detectQctlEnvFor(o.root, { osConfigEnv: os?.env })

  const dirs = schemaDirsForSync(o.root, o.app)
  if (dirs.length === 0) {
    throw new Error(
      o.app
        ? `no .env.schema for app '${o.app}' (or common libs) under applications/ or common/`
        : 'no unit .env.schema under applications/<app>/<unit>/ or common/<lib>/',
    )
  }

  /** @type {Set<string> | null} */
  const consumed =
    o.app && dirs.some((d) => schemaDirIsCommon(o.root, d))
      ? secretNamesConsumedByApp(o.root, o.app)
      : null

  /** @type {CheckRow[]} */
  const rows = []
  /** @type {Map<string, string>} */
  const seen = new Map()

  log(`QCTL_ENV=${qctlEnv} (label ${SECRET_HASH_LABEL})`)

  for (const dir of dirs) {
    const rootful = schemaDirIsRootful(o.root, dir)
    const items = await loadSensitiveItems(dir, { env, qctlEnv, rootful })
    for (const item of items) {
      const name = podmanSecretName(item.key)
      if (consumed && schemaDirIsCommon(o.root, dir) && !consumed.has(name)) continue

      const owner = seen.get(name)
      if (owner) throw new Error(`secret ${name} declared twice (${owner} and ${dir})`)
      seen.set(name, dir)

      if (!item.value) {
        for (const engine of item.engines) {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'mismatch',
            detail: 'empty in graph',
          })
        }
        continue
      }

      const want = secretContentHash(item.value)
      for (const engine of item.engines) {
        if (o.rootlessOnly && engine === 'rootful') {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'skipped',
            detail: 'rootful; rootless-only',
          })
          continue
        }
        if (engine === 'rootful' && uid !== 0) {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'skipped',
            detail: 'rootful; run as root',
          })
          continue
        }

        const exists = podman.run(engine, ['secret', 'exists', name], { capture: true })
        if (exists === null) {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'skipped',
            detail: `${engine} store unavailable`,
          })
          continue
        }
        if (exists.status !== 0) {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'missing',
            detail: `not in ${engine} store`,
          })
          continue
        }
        const have = readSecretHash(podman, engine, name)
        if (have === null) {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'skipped',
            detail: `${engine} store unavailable`,
          })
          continue
        }
        if (!have) {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'unlabeled',
            detail: `no ${SECRET_HASH_LABEL} (run secret sync once)`,
          })
          continue
        }
        if (have === want) {
          rows.push({ name, key: item.key, engine, status: 'match' })
        } else {
          rows.push({
            name,
            key: item.key,
            engine,
            status: 'mismatch',
            detail: 'hash differs from graph',
          })
        }
      }
    }
  }

  for (const r of rows) {
    const tag = r.status === 'match' ? 'ok' : r.status
    const eng = r.engine ? `${r.engine} ` : ''
    log(`${tag} ${eng}secret/${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }

  const drift = rows.filter(
    (r) => r.status === 'mismatch' || r.status === 'missing' || r.status === 'unlabeled',
  )
  const ok = drift.length === 0
  if (!ok) {
    log(`drift: ${drift.length} secret(s) — run: qctl secret sync --restart`)
  } else {
    log(`ok (${rows.filter((r) => r.status === 'match').length} match)`)
  }
  return { ok, rows, qctlEnv }
}
