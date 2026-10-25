/**
 * Host interaction seam: engine paths, podman, systemctl, ownership.
 * Real implementation shells out (runuser for the rootless `apps` user);
 * tests inject `createFakeSystem()` from `test/fake-system.js`.
 *
 * `systemctl` / `podman` are async so the supervisor event loop can still
 * serve apps.sock (ensure) while a quadlet start waits on Requires=qctl-app@.
 */
import { spawn, spawnSync } from 'node:child_process'
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
 * @property {(engine: Engine, args: string[], opts?: ExecOpts) => Promise<ExecResult>} podman
 * @property {(engine: Engine, args: string[], opts?: ExecOpts) => Promise<ExecResult>} systemctl
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
/**
 * @param {ExecOpts} opts
 * @returns {StdioOptions}
 */
function stdioFor(opts) {
  return /** @type {StdioOptions} */ (
    opts.capture
      ? [opts.input !== undefined ? 'pipe' : 'inherit', 'pipe', 'ignore']
      : [
          opts.input !== undefined ? 'pipe' : 'inherit',
          'inherit',
          opts.ignoreStderr ? 'ignore' : 'inherit',
        ]
  )
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {ExecOpts & { cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {ExecResult}
 */
export function execSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: stdioFor(opts),
    input: opts.input,
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
  })
  if (r.error) return { status: 127, stdout: '' }
  return { status: r.status ?? 1, stdout: typeof r.stdout === 'string' ? r.stdout : '' }
}

/**
 * Non-blocking spawn — keeps the supervisor event loop free for other sockets.
 * @param {string} cmd
 * @param {string[]} args
 * @param {ExecOpts & { cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<ExecResult>}
 */
export function execAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: stdioFor(opts),
      cwd: opts.cwd,
      env: opts.env,
    })
    /** @type {Buffer[]} */
    const chunks = []
    if (opts.capture && child.stdout) {
      child.stdout.on('data', (c) => chunks.push(c))
    }
    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input)
    }
    child.on('error', () => {
      resolve({ status: 127, stdout: '' })
    })
    child.on('close', (code) => {
      resolve({
        status: code ?? 1,
        stdout: opts.capture ? Buffer.concat(chunks).toString('utf8') : '',
      })
    })
  })
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
 * @param {{ rootlessUser?: string }} [opts]
 * @returns {System}
 */
export function createSystem(opts = {}) {
  // Identity: caller passes `rootlessUser` from `/etc/qctl/config.json` (not $QCTL_QUADLET_USER).
  const rootlessUser = opts.rootlessUser?.trim() || 'apps'

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
   * @returns {Promise<ExecResult>}
   */
  async function runTool(engine, tool, args, o) {
    if (engine === 'rootless') {
      ensureBus()
      const w = userWrap(rootlessUser)
      const toolArgs = tool === 'systemctl' ? ['systemctl', '--user', ...args] : [tool, ...args]
      return execAsync('runuser', [...w.prefix, ...toolArgs], { ...o, cwd: w.cwd })
    }
    return execAsync(tool, args, o)
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
