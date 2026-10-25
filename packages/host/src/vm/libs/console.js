/**
 * Guest serial without PTY: listen on TCP; qemu connects (--serial tcp,mode=connect).
 * Avoids root-owned file logs and broken virsh-console-over-pipe.
 *
 * ttyS0 cannot receive host winsize over raw serial — soft-wrap on the host instead.
 *
 * Proxmox uses the same line sink via libs/proxmox/serial.mjs (termproxy websocket).
 */
import net from 'node:net'

import { chalk } from 'zx'

/** @typedef {{ status: 'ok' | 'fail', line: string }} SerialOutcome */
/** @typedef {SerialOutcome | { status: 'timeout', line: string }} SerialWaitOutcome */
/** @typedef {{ stop: () => Promise<void>, result: Promise<SerialOutcome> }} SerialFollow */
/**
 * @typedef {object} SerialSinkOpts
 * @property {(line: string) => void} [onLine]
 * @property {(line: string) => SerialOutcome | null} [classify]
 */

/** @returns {number} */
function hostCols() {
  const n = process.stdout.columns
  return typeof n === 'number' && n > 8 ? n : 80
}

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'g')

/**
 * Strip CSI / OSC so pattern match works on systemd colorized console lines.
 * @param {string} s
 * @returns {string}
 */
export function stripAnsi(s) {
  return String(s).replace(CSI_RE, '').replace(OSC_RE, '')
}

/**
 * Soft-wrap so long guest lines don't clip; continuation keeps the │ gutter.
 * @param {string} line
 * @returns {void}
 */
export function writePrefixed(line) {
  const prefix = chalk.dim('│ ')
  // Visible gutter width (│ + space); chalk codes don't take columns.
  const gutter = 2
  const width = Math.max(16, hostCols() - gutter)
  if (line.length <= width) {
    process.stdout.write(`${prefix}${line}\n`)
    return
  }
  for (let i = 0; i < line.length; i += width) {
    process.stdout.write(`${prefix}${line.slice(i, i + width)}\n`)
  }
}

/**
 * Shared CRLF line splitter + classify for local TCP serial and Proxmox termproxy.
 *
 * @param {SerialSinkOpts} [opts]
 */
export function createSerialLineSink(opts = {}) {
  const { onLine, classify } = opts
  let buf = ''
  /** @type {(outcome: SerialOutcome) => void} */
  let settle = () => {}
  /** @type {Promise<SerialOutcome>} */
  const result = new Promise((resolve) => {
    settle = resolve
  })
  let settled = false
  /** @param {string} line */
  const note = (line) => {
    if (settled || !classify) return
    const hit = classify(line)
    if (!hit) return
    settled = true
    settle(hit)
  }

  /** @param {string | Buffer} chunk */
  const onChunk = (chunk) => {
    buf += String(chunk)
    // Serial often uses CRLF. Lone \r is "redraw this line" (progress) — never a blank line.
    for (;;) {
      const nl = buf.indexOf('\n')
      const cr = buf.indexOf('\r')
      if (nl < 0 && cr < 0) break

      // LF ends a line (\r\n or bare \n)
      if (nl >= 0 && (cr < 0 || nl < cr || cr === nl - 1)) {
        let line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        writePrefixed(line)
        onLine?.(line)
        note(line)
        continue
      }

      // Lone CR: wait if it's the last byte (might become CRLF); else discard through CR
      if (cr === buf.length - 1) break
      buf = buf.slice(cr + 1)
    }
  }

  const flush = () => {
    if (!buf.length) return
    const rest = buf.replace(/\r/g, '')
    buf = ''
    writePrefixed(rest)
    onLine?.(rest)
    note(rest)
  }

  return { onChunk, flush, result }
}

/**
 * Optional `unit.service - ` / `unit.target - ` prefix (systemd ≥257 StatusUnitFormat=combined).
 * @type {string}
 */
const UNIT_DASH = '(?:[\\w@.:\\\\-]+\\s+-\\s+)?'

const CLOUD_FINAL_FAIL = new RegExp(`Failed to start ${UNIT_DASH}Cloud-init:\\s*Final Stage`, 'i')
const CLOUD_FINAL_OK = new RegExp(
  `\\[\\s*OK\\s*\\]\\s*Finished ${UNIT_DASH}Cloud-init:\\s*Final Stage`,
  'i',
)
const MULTI_USER_OK = new RegExp(
  `\\[\\s*OK\\s*\\]\\s*Reached target\\s+${UNIT_DASH}(Multi-User System|Graphical Interface)`,
  'i',
)

/**
 * Guest-side failures that mean init-tank will never power off.
 * Do NOT match every systemd [FAILED] (e.g. masked sshd is expected).
 */
export const INIT_TANK_FATAL_PATTERNS = [
  CLOUD_FINAL_FAIL,
  /Failed to start Rocky init-tank/i,
  /rocky-init-tank:\s*ERROR:/i,
  // StageError format from guest `qctl _internal_init` (`stage <name>: …`)
  /stage (?:tier0-seal|data-mounts|tank-import|tank-create|poweroff):/i,
  // Legacy shell-style prefixes (pre-StageError)
  /rocky-data-mounts:\s*ERROR:/i,
  /rocky-vw-mount:\s*ERROR:/i,
]

/**
 * @param {string} line
 * @returns {string | null}
 */
export function matchInitTankFatal(line) {
  const plain = stripAnsi(line)
  for (const re of INIT_TANK_FATAL_PATTERNS) {
    if (re.test(plain)) return plain.trim()
  }
  return null
}

/**
 * Appliance `vm up`: wait for cloud-final success/failure.
 *
 * Prefer systemd's Finished line (legacy description-only, or ≥257
 * `unit.service - Description`). Rocky 10 serial often never shows `[  OK  ]`
 * status (console goes elsewhere after many `systemctl daemon-reexec` during
 * `dnf upgrade`), so also accept our seed `final_message` marker — it runs as
 * the last Final Stage module and is mirrored to the serial console.
 *
 * @param {string} line
 * @returns {SerialOutcome | null}
 */
export function classifyCloudInitOutcome(line) {
  const plain = stripAnsi(line)
  if (CLOUD_FINAL_FAIL.test(plain)) {
    return { status: 'fail', line: plain.trim() }
  }
  if (/Failed to start Rocky appliance first-boot/i.test(plain)) {
    return { status: 'fail', line: plain.trim() }
  }
  // First-boot script dies (visible once unit uses journal+console)
  if (/rocky-(?:vw|tank|baseline):\s*ERROR:/i.test(plain)) {
    return { status: 'fail', line: plain.trim() }
  }
  if (CLOUD_FINAL_OK.test(plain)) {
    return { status: 'ok', line: plain.trim() }
  }
  // Seed final_message (packages/host/seed/cloud-init/user-data.yaml) — last Final Stage module.
  if (/Expect disks:\s*OS \+ \/vw/i.test(plain)) {
    return { status: 'ok', line: plain.trim() }
  }
  return null
}

/**
 * Resume (`down` → `up`): wait until the guest looks booted.
 * Cloud-init Final Stage does not reappear on later boots.
 *
 * @param {string} line
 * @returns {SerialOutcome | null}
 */
export function classifyRebootReady(line) {
  const plain = stripAnsi(line)
  if (/rocky-(?:vw|tank|baseline|tank-unlock):\s*ERROR:/i.test(plain)) {
    return { status: 'fail', line: plain.trim() }
  }
  if (/Failed to start\s+.*(?:tank|Rocky)/i.test(plain)) {
    return { status: 'fail', line: plain.trim() }
  }
  if (MULTI_USER_OK.test(plain)) {
    return { status: 'ok', line: plain.trim() }
  }
  return null
}

/**
 * Incomplete first-boot resume: accept cloud-init Final Stage or multi-user
 * (guest may already be past Final Stage / legacy installs without the flag).
 *
 * @param {string} line
 * @returns {SerialOutcome | null}
 */
export function classifyContinueFirstBoot(line) {
  return classifyCloudInitOutcome(line) ?? classifyRebootReady(line)
}

/**
 * @param {SerialSinkOpts} [opts]
 * @returns {Promise<{
 *   port: number,
 *   stop: () => Promise<void>,
 *   result: Promise<SerialOutcome>,
 * }>}
 */
export async function startSerialTcpFollow(opts = {}) {
  const sink = createSerialLineSink(opts)
  /** @type {Set<net.Socket>} */
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    console.log(chalk.dim('vm: guest serial connected'))
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => sink.onChunk(chunk))
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
  })

  const port = await new Promise((/** @type {(p: number) => void} */ resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })

  console.log(chalk.cyan(`vm: listening for guest serial on 127.0.0.1:${port}`))

  const stop = async () => {
    sink.flush()
    for (const s of sockets) {
      try {
        s.destroy()
      } catch {
        /* ignore */
      }
    }
    sockets.clear()
    await new Promise((resolve) => {
      server.close(() => resolve(undefined))
    })
  }

  return { port, stop, result: sink.result }
}
