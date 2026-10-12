/**
 * Host interaction seam: engine paths, podman, systemctl, ownership.
 * Real implementation shells out (runuser for the rootless `apps` user);
 * tests inject `createFakeSystem()` from `test/fake-system.js`.
 */
import { spawnSync } from 'node:child_process'
import { chownSync, statSync } from 'node:fs'

import { die } from './errors.js'
/** @import { StdioOptions } from 'node:child_process' */

/** @typedef {'rootless' | 'rootful'} Engine */

/**
 * @typedef {object} EnginePaths
 * @property {Engine} engine
 * @property {string} dest        Quadlet install dir (containers/systemd)
 * @property {string} sysDest     plain systemd unit dir
 * @property {string} wantedBy
 * @property {string | null} asUser  owner of installed files (rootless user) or null
 */

/**
 * @typedef {object} ExecOpts
 * @property {boolean} [capture]       capture stdout (stderr discarded)
 * @property {boolean} [ignoreStderr]  discard stderr, inherit stdout
 * @property {string} [input]          stdin
 */

/**
 * @typedef {object} ExecResult
 * @property {number} status
 * @property {string} stdout
 */

/**
 * @typedef {object} System
 * @property {() => number} uid
 * @property {string} rootlessUser
 * @property {(engine: Engine) => EnginePaths} paths
 * @property {(engine: Engine, args: string[], opts?: ExecOpts) => ExecResult} podman
 * @property {(engine: Engine, args: string[], opts?: ExecOpts) => ExecResult} systemctl
 * @property {() => void} ensureRootlessBus
 * @property {(engine: Engine, path: string) => void} chown
 * @property {(cmd: string, args: string[], opts?: ExecOpts) => ExecResult} exec
 */

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {ExecOpts & { cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {ExecResult}
 */
export function execSync(cmd, args, opts = {}) {
  const stdio = /** @type {StdioOptions} */ (
    opts.capture
      ? [opts.input !== undefined ? 'pipe' : 'inherit', 'pipe', 'ignore']
      : [
          opts.input !== undefined ? 'pipe' : 'inherit',
          'inherit',
          opts.ignoreStderr ? 'ignore' : 'inherit',
        ]
  )
  const r = spawnSync(cmd, args, {
    stdio,
    input: opts.input,
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
  })
  if (r.error) return { status: 127, stdout: '' }
  return { status: r.status ?? 1, stdout: typeof r.stdout === 'string' ? r.stdout : '' }
}

/**
 * @param {string} user
 * @returns {string}
 */
export function userHome(user) {
  const r = execSync('getent', ['passwd', user], { capture: true })
  const home = r.status === 0 ? r.stdout.trim().split(':')[5] : undefined
  if (!home || home === '/' || home === '/nonexistent') die(`no home directory for user '${user}'`)
  return home
}

/**
 * @param {string} user
 * @returns {number}
 */
function userUid(user) {
  const r = execSync('id', ['-u', user], { capture: true })
  if (r.status !== 0) die(`rootless user '${user}' missing`)
  return Number(r.stdout.trim())
}

/**
 * @param {{ rootlessUser?: string, env?: Record<string, string | undefined> }} [opts]
 * @returns {System}
 */
export function createSystem(opts = {}) {
  const env = opts.env ?? process.env
  const rootlessUser = opts.rootlessUser ?? env.QCTL_QUADLET_USER ?? 'apps'

  /** @param {Engine} engine */
  const asUserFor = (engine) => (engine === 'rootless' ? rootlessUser : null)

  /**
   * Command wrapped for the rootless user (runuser + user bus env).
   * @param {string} user
   * @returns {{ prefix: string[], cwd: string }}
   */
  function userWrap(user) {
    const uid = userUid(user)
    const home = userHome(user)
    const rt = `/run/user/${uid}`
    return {
      cwd: home,
      prefix: [
        '-u',
        user,
        '--',
        'env',
        `XDG_RUNTIME_DIR=${rt}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=${rt}/bus`,
        `HOME=${home}`,
      ],
    }
  }

  /**
   * @param {Engine} engine
   * @param {string} tool
   * @param {string[]} args
   * @param {ExecOpts} [o]
   * @returns {ExecResult}
   */
  function runTool(engine, tool, args, o) {
    if (engine === 'rootless') {
      ensureBus()
      const w = userWrap(rootlessUser)
      const toolArgs = tool === 'systemctl' ? ['systemctl', '--user', ...args] : [tool, ...args]
      return execSync('runuser', [...w.prefix, ...toolArgs], { ...o, cwd: w.cwd })
    }
    return execSync(tool, args, o)
  }

  function ensureBus() {
    const uid = userUid(rootlessUser)
    const bus = `/run/user/${uid}/bus`
    const has = () => {
      try {
        return statSync(bus).isSocket()
      } catch {
        return false
      }
    }
    if (!has()) {
      console.log(`quadlet: starting user@${uid}.service for ${rootlessUser}`)
      execSync('systemctl', ['start', `user@${uid}.service`])
    }
    if (!has()) die(`no user bus at ${bus} (loginctl enable-linger ${rootlessUser})`)
  }

  return {
    uid: () => process.getuid?.() ?? 0,
    rootlessUser,
    paths(engine) {
      if (engine === 'rootless') {
        const home = userHome(rootlessUser)
        return {
          engine,
          dest: `${home}/.config/containers/systemd`,
          sysDest: `${home}/.config/systemd/user`,
          wantedBy: 'default.target',
          asUser: rootlessUser,
        }
      }
      return {
        engine,
        dest: '/etc/containers/systemd',
        sysDest: '/etc/systemd/system',
        wantedBy: 'multi-user.target',
        asUser: asUserFor(engine),
      }
    },
    podman: (engine, args, o) => runTool(engine, 'podman', args, o),
    systemctl: (engine, args, o) => runTool(engine, 'systemctl', args, o),
    ensureRootlessBus: ensureBus,
    chown(engine, path) {
      const user = asUserFor(engine)
      if (!user) return
      const uid = userUid(user)
      const gid = Number(execSync('id', ['-g', user], { capture: true }).stdout.trim())
      try {
        chownSync(path, uid, gid)
      } catch {
        // best effort (symlink / vanished)
      }
    },
    exec: execSync,
  }
}

/**
 * Build argv for re-exec of this qctl binary with `userArgv`.
 * @param {string[]} userArgv
 * @returns {string[]}
 */
function selfCmd(userArgv) {
  const script = process.argv[1]
  const isJs =
    typeof script === 'string' && /\.[cm]?[jt]s$/.test(script) && !script.startsWith('/$bunfs')
  const self = isJs ? [process.execPath, /** @type {string} */ (script)] : [process.execPath]
  return [...self, ...userArgv]
}

/**
 * Prefer root via `sudo -n`. Returns true when already root.
 * On successful sudo re-exec, does not return (`process.exit`).
 * Returns false when passwordless sudo is unavailable (caller may continue as non-root).
 * @param {string[]} userArgv args after the binary (e.g. ["quadlet", "up"])
 * @param {System} sys
 * @returns {boolean}
 */
export function tryEnsureRoot(userArgv, sys) {
  if (sys.uid() === 0) return true
  const cmd = selfCmd(userArgv)
  if (execSync('sudo', ['-n', 'true'], { capture: true }).status === 0) {
    const r = spawnSync('sudo', ['-n', '--', ...cmd], { stdio: 'inherit' })
    process.exit(r.status ?? 1)
  }
  return false
}

/**
 * Re-exec this qctl invocation via passwordless sudo when not root.
 * Returns normally only when already root; otherwise exits or dies.
 * @param {string[]} userArgv args after the binary (e.g. ["quadlet", "up"])
 * @param {System} sys
 */
export function ensureRoot(userArgv, sys) {
  if (tryEnsureRoot(userArgv, sys)) return
  die(`need root — try: sudo ${selfCmd(userArgv).join(' ')}`)
}
