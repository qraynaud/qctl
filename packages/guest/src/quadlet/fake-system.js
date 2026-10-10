/**
 * In-memory `System` for tests: engine paths live in a temp dir, every
 * podman/systemctl/exec call is recorded, responses are scriptable.
 */
import { join } from 'node:path'

/** @import { ExecResult, System } from './system.js' */

/**
 * @typedef {object} FakeCall
 * @property {'podman' | 'systemctl' | 'exec' | 'chown' | 'bus'} kind
 * @property {string} engine
 * @property {string[]} args
 * @property {string} line   "kind:engine args…" for easy asserting
 */

/**
 * Realistic idle host: no podman networks/containers, units inactive.
 * @param {FakeCall['kind']} kind
 * @param {string[]} args
 * @returns {number}
 */
function defaultStatus(kind, args) {
  if (kind === 'podman') {
    if (args[0] === 'network' && args[1] === 'exists') return 1
    if (args[0] === 'container' && args[1] === 'inspect') return 125
    if (args[0] === 'secret' && args[1] === 'exists') return 1
  }
  if (kind === 'systemctl' && (args[0] === 'is-active' || args[0] === 'is-failed')) return 3
  return 0
}

/**
 * @param {{
 *   dir: string,
 *   uid?: number,
 *   respond?: (call: FakeCall) => Partial<ExecResult> | undefined,
 * }} opts
 * @returns {System & { calls: FakeCall[], lines: () => string[] }}
 */
export function createFakeSystem(opts) {
  /** @type {FakeCall[]} */
  const calls = []

  /**
   * @param {FakeCall['kind']} kind
   * @param {string} engine
   * @param {string[]} args
   * @returns {ExecResult}
   */
  const record = (kind, engine, args) => {
    const call = { kind, engine, args, line: `${kind}:${engine} ${args.join(' ')}`.trim() }
    calls.push(call)
    const r = opts.respond?.(call)
    return { status: r?.status ?? defaultStatus(kind, args), stdout: r?.stdout ?? '' }
  }

  return {
    calls,
    lines: () => calls.map((c) => c.line),
    uid: () => opts.uid ?? 0,
    rootlessUser: 'apps',
    paths(engine) {
      return {
        engine,
        dest: join(opts.dir, engine, 'containers-systemd'),
        sysDest: join(opts.dir, engine, 'systemd'),
        wantedBy: engine === 'rootless' ? 'default.target' : 'multi-user.target',
        asUser: engine === 'rootless' ? 'apps' : null,
      }
    },
    podman: (engine, args) => record('podman', engine, args),
    systemctl: (engine, args) => record('systemctl', engine, args),
    ensureRootlessBus: () => {
      record('bus', 'rootless', [])
    },
    chown: () => {},
    exec: (cmd, args) => record('exec', '-', [cmd, ...args]),
  }
}
