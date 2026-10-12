/**
 * Shared wait / abort helpers for local driver (and serial waits).
 */
import net from 'node:net'

/** @import { SerialOutcome, SerialWaitOutcome } from './console.js' */

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  if (!err || typeof err !== 'object') return false
  const e = /** @type {{ name?: string, code?: string }} */ (err)
  return e.name === 'AbortError' || e.code === 'ABORT_ERR'
}

/**
 * True if TCP connect to host:port succeeds within ~1s.
 * @param {string} host
 * @param {number} port
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
export function tcpPortOpen(host, port, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const sock = net.connect({ host, port }, () => {
      sock.destroy()
      resolve(true)
    })
    /** @param {boolean} ok */
    const done = (ok) => {
      sock.removeAllListeners()
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    sock.setTimeout(1000)
    sock.on('error', () => done(false))
    sock.on('timeout', () => done(false))
    signal?.addEventListener('abort', () => done(false), { once: true })
  })
}

/**
 * True if the peer sends an OpenSSH banner (passt can accept TCP even when guest
 * sshd is masked — connect-only checks are false positives).
 * @param {string} host
 * @param {number} port
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
export function sshBannerReady(host, port, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const sock = net.connect({ host, port })
    let buf = ''
    /** @param {boolean} ok */
    const done = (ok) => {
      sock.removeAllListeners()
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    sock.setTimeout(2000)
    sock.setEncoding('utf8')
    sock.on('data', (chunk) => {
      buf += chunk
      if (buf.includes('SSH-')) done(true)
    })
    sock.on('error', () => done(false))
    sock.on('timeout', () => done(false))
    sock.on('close', () => done(buf.includes('SSH-')))
    signal?.addEventListener('abort', () => done(false), { once: true })
  })
}

/**
 * After guest reboot: wait until listed local passt ports are ready.
 * Ports in `sshPorts` must yield an OpenSSH banner (passt accepts TCP even when
 * guest sshd is still masked).
 * @param {{
 *   host?: string,
 *   ports: number[],
 *   sshPorts?: number[],
 *   timeoutSec?: number,
 *   signal?: AbortSignal,
 *   label?: string,
 * }} opts
 */
export async function waitForLocalTcpPorts({
  host = '127.0.0.1',
  ports,
  sshPorts = [],
  timeoutSec = 180,
  signal,
  label = 'services',
}) {
  const { chalk } = await import('zx')
  const list = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0))]
  const sshSet = new Set(sshPorts.filter((p) => Number.isInteger(p) && p > 0))
  if (!list.length) return

  /** @param {number} p */
  const probe = (p) =>
    sshSet.has(p) ? sshBannerReady(host, p, signal) : tcpPortOpen(host, p, signal)

  console.log(
    chalk.cyan(
      `vm: waiting for ${label} on ${list.map((p) => `${host}:${p}`).join(', ')} `
        + `(timeout ${timeoutSec}s)…`,
    ),
  )

  const deadline = Date.now() + timeoutSec * 1000
  // Let ACPI reboot tear down old listeners before we treat "open" as post-boot.
  const downDeadline = Date.now() + 60_000
  while (Date.now() < downDeadline) {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    const anyUp = (await Promise.all(list.map((p) => tcpPortOpen(host, p, signal)))).some(Boolean)
    if (!anyUp) break
    await sleep(1000, signal)
  }

  while (Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    const flags = await Promise.all(list.map((p) => probe(p)))
    if (flags.every(Boolean)) {
      console.log(chalk.green(`vm: ${label} reachable`))
      return
    }
    await sleep(2000, signal)
  }

  const { die } = await import('../../lib/util.js')
  die(
    `${label} not reachable on ${list.map((p) => `${host}:${p}`).join(', ')} within ${timeoutSec}s`,
  )
}

/**
 * Wait for serial classify OK/KO, or timeout.
 * @param {{ result: Promise<SerialOutcome> }} consoleFollow
 * @param {number} timeoutSec
 * @param {AbortSignal | undefined} signal
 * @param {{ waiting: string, timeoutLine: string }} msgs
 * @returns {Promise<SerialWaitOutcome>}
 */
export async function waitForSerialOutcome(consoleFollow, timeoutSec, signal, msgs) {
  const { chalk } = await import('zx')
  console.log(chalk.cyan(msgs.waiting))

  const deadline = Date.now() + timeoutSec * 1000
  const waitAc = new AbortController()
  const onParentAbort = () => waitAc.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  const timeout = (async () => {
    while (Date.now() < deadline) {
      if (waitAc.signal.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      }
      await sleep(Math.min(5000, Math.max(100, deadline - Date.now())), waitAc.signal)
    }
    return /** @type {SerialWaitOutcome} */ ({ status: 'timeout', line: msgs.timeoutLine })
  })()

  try {
    const outcome = await Promise.race([consoleFollow.result, timeout])
    waitAc.abort()
    await timeout.catch(() => {})
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    return outcome
  } finally {
    signal?.removeEventListener('abort', onParentAbort)
  }
}
