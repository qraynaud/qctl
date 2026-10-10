/**
 * Stream guest serial from Proxmox via termproxy → vncwebsocket (xterm.js framing).
 * Same line sink / classify as local TCP serial (libs/console.mjs).
 */
import { chalk } from 'zx'

import { createSerialLineSink } from '../console.js'

/** @import { SerialOutcome, SerialSinkOpts } from '../console.js' */
/** @import { ProxmoxClient } from './client.js' */

/**
 * @param {string | ArrayBuffer | Blob | Buffer} data
 * @returns {Promise<string>}
 */
async function decodeWsData(data) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer()).toString('utf8')
  }
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  return String(data)
}

/**
 * Strip PVE xterm data frame: `0:<len>:<payload>`
 * @param {string} text
 * @returns {string}
 */
function xtermPayload(text) {
  const m = /^0:(\d+):([\s\S]*)$/.exec(text)
  if (!m) return text
  return (m[2] ?? '').slice(0, Number(m[1]))
}

/**
 * @param {ProxmoxClient} client
 * @param {number} vmid
 * @param {string} name
 * @param {SerialSinkOpts} [opts]
 * @returns {Promise<{
 *   stop: () => Promise<void>,
 *   result: Promise<SerialOutcome>,
 * }>}
 */
export async function startProxmoxSerialFollow(client, vmid, name, opts = {}) {
  const { apiUrl, apiToken, node } = client.config
  const sink = createSerialLineSink(opts)

  const referer = `${apiUrl}/?console=kvm&xtermjs=1&vmid=${vmid}&vmname=${encodeURIComponent(name)}&node=${encodeURIComponent(node)}&cmd=`
  const tpUrl = new URL(
    `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/termproxy`,
    apiUrl,
  )
  const tpRes = await fetch(tpUrl, {
    method: 'POST',
    headers: {
      Authorization: `PVEAPIToken=${apiToken}`,
      Accept: 'application/json',
      Referer: referer,
    },
  })
  const tpText = await tpRes.text()
  /** @type {{ data?: { port?: number, ticket?: string, user?: string }, errors?: unknown, message?: unknown }} */
  let tpJson
  try {
    tpJson = JSON.parse(tpText)
  } catch {
    throw new Error(`Proxmox termproxy non-JSON (${tpRes.status}): ${tpText.slice(0, 300)}`)
  }
  if (!tpRes.ok) {
    throw new Error(
      `Proxmox termproxy HTTP ${tpRes.status}: ${JSON.stringify(tpJson?.errors || tpJson?.message || tpJson)}`,
    )
  }
  const { port, ticket, user } = tpJson.data || {}
  if (!port || !ticket || !user) {
    throw new Error(`Proxmox termproxy missing fields: ${JSON.stringify(tpJson)}`)
  }

  const wsUrl = new URL(
    `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncwebsocket`,
    apiUrl,
  )
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl.searchParams.set('port', String(port))
  wsUrl.searchParams.set('vncticket', ticket)

  console.log(chalk.cyan(`vm: streaming Proxmox serial (termproxy) for ${name}…`))

  /** @type {WebSocket | undefined} */
  let ws
  let closed = false
  let chain = Promise.resolve()

  await new Promise((resolve, reject) => {
    /** @type {WebSocket} */
    let socket
    try {
      // Bun's WebSocket accepts `{ headers }`; DOM lib typings only know `string[]` protocols.
      socket = new WebSocket(
        wsUrl.toString(),
        /** @type {never} */ ({ headers: { Authorization: `PVEAPIToken=${apiToken}` } }),
      )
    } catch (err) {
      reject(err)
      return
    }
    ws = socket

    socket.addEventListener('open', () => {
      console.log(chalk.dim('vm: guest serial connected'))
      socket.send(`${user}:${ticket}\n`)
      const cols = typeof process.stdout.columns === 'number' ? process.stdout.columns : 120
      const rows = typeof process.stdout.rows === 'number' ? process.stdout.rows : 40
      socket.send(`1:${Math.max(40, cols)}:${Math.max(12, rows)}:`)
      resolve(undefined)
    })

    socket.addEventListener('message', (ev) => {
      chain = chain
        .then(async () => {
          if (closed) return
          const text = await decodeWsData(ev.data)
          const payload = xtermPayload(text)
          if (payload) sink.onChunk(payload)
        })
        .catch(() => {})
    })

    socket.addEventListener('error', (err) => {
      if (closed) return
      reject(
        /** @type {{ error?: Error }} */ (err).error
          || err
          || new Error('Proxmox serial websocket error'),
      )
    })
  })

  const stop = async () => {
    if (closed) return
    closed = true
    await chain.catch(() => {})
    sink.flush()
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
  }

  return { stop, result: sink.result }
}
