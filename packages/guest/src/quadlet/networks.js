/**
 * Shared / app-local Podman network helpers.
 * Shared packages: networks/<name>/<name>.network (+ optional <name>.env, host-macvlan shim).
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { packageUnitFiles } from './apps.js'
import { renderFile } from './env.js'
/** @import { QuadletContext } from './context.js' */
/** @import { RenderEnv } from './env.js' */
/** @import { Engine, EnginePaths } from './system.js' */

/**
 * @param {{ root: string }} ctx
 * @returns {string | null}
 */
export function networksSrc(ctx) {
  const d = join(ctx.root, 'networks')
  return existsSync(d) ? d : null
}

/**
 * Shared network unit files: networks/<n>/<n>.network (absolute, sorted by dir).
 * @param {{ root: string }} ctx
 * @returns {string[]}
 */
export function listSharedNetworkFiles(ctx) {
  const src = networksSrc(ctx)
  if (!src) return []
  /** @type {string[]} */
  const out = []
  for (const n of readdirSync(src).sort()) {
    const f = join(src, n, `${n}.network`)
    if (existsSync(f)) out.push(f)
  }
  return out
}

/**
 * @param {{ root: string }} ctx
 * @param {string} base unit basename (vlan2.network or vlan2)
 * @returns {string | null}
 */
export function sharedNetworkFile(ctx, base) {
  const src = networksSrc(ctx)
  if (!src) return null
  const stem = base.endsWith('.network') ? base.slice(0, -'.network'.length) : base
  const f = join(src, stem, `${stem}.network`)
  return existsSync(f) ? f : null
}

/**
 * macvlan/ipvlan → rootful (L2 parents); everything else → rootless.
 * @param {string} file
 * @returns {Engine}
 */
export function networkSharedEngine(file) {
  try {
    if (/^Driver[ \t]*=[ \t]*(macvlan|ipvlan)[ \t]*$/im.test(readFileSync(file, 'utf8')))
      return 'rootful'
  } catch {
    // unreadable → rootless
  }
  return 'rootless'
}

/**
 * Value of KEY= under [Network] (trimmed; does not split on '=' inside the value).
 * @param {string} file
 * @param {string} key
 * @returns {string}
 */
export function networkUnitGet(file, key) {
  let sect = ''
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) {
      sect = line
      continue
    }
    if (sect === '[Network]' && line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1).trim()
    }
  }
  return ''
}

/**
 * parent= token from Options=parent=…
 * @param {string} file
 * @returns {string}
 */
export function networkUnitParent(file) {
  const opts = networkUnitGet(file, 'Options')
  for (const part of opts.split(',')) {
    const p = part.trim()
    if (p.startsWith('parent=')) return p.slice('parent='.length)
  }
  return ''
}

/**
 * Podman network name from NetworkName= or the file stem.
 * @param {string} file
 * @returns {string}
 */
export function networkPodmanName(file) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // fall back to stem
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('NetworkName=')) {
      const n = line.slice('NetworkName='.length).replace(/\s/g, '')
      if (n) return n
    }
  }
  return basename(file, '.network')
}

/**
 * True if a Podman network exists but drifts from the installed unit
 * (Subnet/Gateway/Driver/parent). Absent network → not stale.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} unitFile installed .network
 * @returns {boolean}
 */
export function networkLiveStale(ctx, paths, unitFile) {
  if (!existsSync(unitFile)) return false
  const name = networkPodmanName(unitFile)
  const q = { capture: true }
  if (ctx.sys.podman(paths.engine, ['network', 'exists', name], q).status !== 0) return false

  /** @param {string} fmt */
  const inspect = (fmt) => {
    const r = ctx.sys.podman(paths.engine, ['network', 'inspect', name, '--format', fmt], q)
    return r.status === 0 ? r.stdout.replace(/\n$/, '') : ''
  }
  const wantSub = networkUnitGet(unitFile, 'Subnet')
  const wantGw = networkUnitGet(unitFile, 'Gateway')
  const wantDrv = networkUnitGet(unitFile, 'Driver')
  const wantParent = networkUnitParent(unitFile)

  const liveSub = inspect('{{range .Subnets}}{{.Subnet}}{{end}}')
  const liveGw = inspect('{{range .Subnets}}{{.Gateway}}{{end}}')
  const liveDrv = inspect('{{.Driver}}')
  // Macvlan/ipvlan: Options=parent=X lands in NetworkInterface; Options map is often
  // empty after create. Prefer interface, fall back to Options.
  let liveParent = inspect(
    '{{if .NetworkInterface}}{{.NetworkInterface}}{{else}}{{index .Options "parent"}}{{end}}',
  )
  if (liveParent === '<no value>') liveParent = ''

  if (wantSub && liveSub !== wantSub) return true
  if (wantGw && liveGw !== wantGw) return true
  if (wantDrv && liveDrv !== wantDrv) return true
  if (wantParent && liveParent !== wantParent) return true
  return false
}

/**
 * Stop network unit, `podman network rm -f`, start unit (recreates from Quadlet).
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} baseName
 * @returns {boolean}
 */
export function recreatePodmanNetwork(ctx, paths, baseName) {
  const base = baseName.endsWith('.network') ? baseName : `${baseName}.network`
  const dest = join(paths.dest, base)
  if (!existsSync(dest)) return false
  const netName = networkPodmanName(dest)
  const svc = `${base.slice(0, -'.network'.length)}-network.service`
  if (paths.engine === 'rootless') ctx.sys.ensureRootlessBus()
  ctx.log(`recreate podman network ${netName} (${paths.engine}; ${svc})`)
  ctx.sys.systemctl(paths.engine, ['stop', svc], { ignoreStderr: true })
  ctx.sys.podman(paths.engine, ['network', 'rm', '-f', netName], { ignoreStderr: true })
  // Generator must see the updated unit before start.
  ctx.sys.systemctl(paths.engine, ['daemon-reload'])
  return ctx.sys.systemctl(paths.engine, ['start', svc]).status === 0
}

/**
 * Optional host-macvlan companions from networks/<n>/ (rootful only).
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} netFile
 * @param {RenderEnv} renv
 * @returns {boolean} true when installed
 */
export function installNetworkHostMacvlan(ctx, paths, netFile, renv) {
  const dir = dirname(netFile)
  const stem = basename(netFile, '.network')
  const scriptSrc = join(dir, `${stem}-host-macvlan.sh`)
  const unitSrc = join(dir, `${stem}-host-macvlan.service`)
  if (!existsSync(scriptSrc) || !existsSync(unitSrc)) return false
  if (paths.engine !== 'rootful') return false

  const libdir = join(ctx.seedDir, 'networks', stem)
  const sysUnitDir = paths.sysDest
  mkdirSync(libdir, { recursive: true })
  const s = renv.scope
  writeFileSync(
    join(libdir, `${stem}-host.env`),
    `VLAN2_PARENT=${s.VLAN2_PARENT || 'vlan2'}\n`
      + `VLAN2_SUBNET=${s.VLAN2_SUBNET ?? ''}\n`
      + `VLAN2_GATEWAY=${s.VLAN2_GATEWAY ?? ''}\n`
      + `VLAN2_IPV4=${s.VLAN2_IPV4 ?? ''}\n`,
  )
  chmodSync(join(libdir, `${stem}-host.env`), 0o644)
  // Script has no ${VAR} templates — install verbatim.
  const scriptDest = join(libdir, `${stem}-host-macvlan.sh`)
  copyFileSync(scriptSrc, scriptDest)
  chmodSync(scriptDest, 0o755)
  mkdirSync(sysUnitDir, { recursive: true })
  const unitDest = join(sysUnitDir, `${stem}-host-macvlan.service`)
  writeFileSync(unitDest, renderFile(unitSrc, renv))
  chmodSync(unitDest, 0o644)
  ctx.sys.systemctl('rootful', ['daemon-reload'])
  ctx.sys.systemctl('rootful', ['enable', `${stem}-host-macvlan.service`], { capture: true })
  ctx.sys.systemctl('rootful', ['restart', `${stem}-host-macvlan.service`])
  return true
}

/**
 * Stop Quadlet network unit, remove installed files, `podman network rm -f`.
 * @param {QuadletContext} ctx
 * @param {EnginePaths} paths
 * @param {string} baseName
 */
export function removeNetworkUnit(ctx, paths, baseName) {
  const base = baseName.endsWith('.network') ? baseName : `${baseName}.network`
  const dest = join(paths.dest, base)
  if (!existsSync(dest)) return
  const netName = networkPodmanName(dest)
  const svc = `${base.slice(0, -'.network'.length)}-network.service`
  if (paths.engine === 'rootless') ctx.sys.ensureRootlessBus()
  ctx.sys.systemctl(paths.engine, ['stop', svc], { ignoreStderr: true })
  rmSync(`${dest}.d`, { recursive: true, force: true })
  rmSync(dest, { force: true })
  ctx.sys.podman(paths.engine, ['network', 'rm', '-f', netName], { ignoreStderr: true })
}

/**
 * Network= refs from one unit file (strips :ip=… options, comma lists).
 * @param {string} file
 * @returns {string[]}
 */
export function networkRefsFromFile(file) {
  /** @type {string[]} */
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('Network=')) continue
    const val = (line.slice('Network='.length).split('#')[0] ?? '')
      .replace(/ /g, '')
      .replaceAll(',', ' ')
    for (const part of val.split(' ')) {
      const ref = part.split(':')[0] ?? ''
      if (ref) out.push(ref)
    }
  }
  return out
}

/**
 * Network= refs from an app's containers/pods/kubes (package root + unit dirs).
 * @param {string} dir
 * @returns {string[]} sorted unique
 */
export function appNetworkRefs(dir) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const f of packageUnitFiles(dir, ['container', 'pod', 'kube'])) {
    for (const ref of networkRefsFromFile(f)) out.add(ref)
  }
  return [...out].sort()
}

/**
 * True if the app references any of the given network unit basenames.
 * @param {string} dir
 * @param {string[]} dirty network unit basenames (caddy.network)
 * @returns {boolean}
 */
export function appUsesNetworks(dir, dirty) {
  if (dirty.length === 0) return false
  for (const ref of appNetworkRefs(dir)) {
    for (const d of dirty) {
      const base = basename(d)
      if (ref === base || ref === base.replace(/\.network$/, '') || ref === d) return true
    }
  }
  return false
}
