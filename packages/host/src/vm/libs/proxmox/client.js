/**
 * Minimal Proxmox VE JSON API client (API token auth).
 * Every JSON `data` payload is validated with a Zod schema.
 */

import { z } from 'zod'
import { chalk } from 'zx'

import { die } from '../../../lib/util.js'
import {
  pveNextId,
  pveQemuConfig,
  pveQemuList,
  pveQemuStatus,
  pveTaskStatus,
  pveUpid,
  pveVersion,
} from './api-schemas.js'

/** @import { ProxmoxConfig, ProxmoxRequestFields, QemuConfig, RequestOpts } from './types.js' */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Soft transport/HTTP failure as a Zod safeParse-shaped result.
 * @param {string} message
 * @returns {{ success: false, error: z.ZodError }}
 */
function softFail(message) {
  return {
    success: false,
    error: new z.ZodError([{ code: 'custom', message, path: [] }]),
  }
}

/**
 * @param {ProxmoxConfig} config
 */
export function createProxmoxClient(config) {
  const { apiUrl, apiToken, node } = config
  /** @type {Record<string, string>} */
  const authHeaders = {
    Authorization: `PVEAPIToken=${apiToken}`,
    Accept: 'application/json',
  }

  /**
   * JSON API call. `schema` validates `data`; soft → safeParse result, else inferred data.
   * @template {z.ZodType} S
   * @template TBody
   * @template {boolean} TSoft
   * @param {S} schema
   * @param {string} method
   * @param {string} apiPath
   * @param {RequestOpts<TBody, TSoft>} [opts]
   * @returns {Promise<TSoft extends true ? z.ZodSafeParseResult<z.infer<S>> : z.infer<S>>}
   */
  async function request(
    schema,
    method,
    apiPath,
    { query, body, form, soft = /** @type {TSoft} */ (false) } = {},
  ) {
    const url = new URL(`/api2/json${apiPath}`, apiUrl)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v == null) continue
        url.searchParams.set(k, String(v))
      }
    }

    /** @type {RequestInit & { headers: Record<string, string> }} */
    const init = { method, headers: { ...authHeaders } }
    if (form) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
      init.body = new URLSearchParams(
        Object.fromEntries(
          Object.entries(form)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)]),
        ),
      ).toString()
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    /** @typedef {Awaited<ReturnType<typeof request<S, TBody, TSoft>>>} RequestResult */

    let res
    try {
      res = await fetch(url, init)
    } catch (err) {
      const msg = `Proxmox API ${method} ${url.pathname}: ${
        err instanceof Error ? err.message : String(err)
      }`
      if (soft) return /** @type {RequestResult} */ (softFail(msg))
      die(msg)
    }

    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      const msg = `Proxmox API ${method} ${url.pathname}: non-JSON (${res.status}): ${text.slice(0, 200)}`
      if (soft) return /** @type {RequestResult} */ (softFail(msg))
      die(msg)
    }

    if (!res.ok) {
      const detail = json?.errors
        ? JSON.stringify(json.errors)
        : json?.message || text.slice(0, 300)
      const msg = `Proxmox API ${method} ${url.pathname}: HTTP ${res.status}: ${detail}`
      if (soft) return /** @type {RequestResult} */ (softFail(msg))
      die(msg)
    }

    const parsed = schema.safeParse(json?.data)
    if (soft) return /** @type {RequestResult} */ (parsed)
    if (!parsed.success) {
      die(`Proxmox API ${method} ${url.pathname}:\n${z.prettifyError(parsed.error)}`)
    }
    return /** @type {RequestResult} */ (parsed.data)
  }

  /**
   * @template {z.ZodType} S
   * @param {S} schema
   * @param {string} apiPath
   * @param {ProxmoxRequestFields} [query]
   * @returns {Promise<z.infer<S>>}
   */
  const get = (schema, apiPath, query) =>
    request(schema, 'GET', apiPath, { query, soft: /** @type {false} */ (false) })
  /**
   * @template {z.ZodType} S
   * @param {S} schema
   * @param {string} apiPath
   * @param {ProxmoxRequestFields} [query]
   * @returns {Promise<z.ZodSafeParseResult<z.infer<S>>>}
   */
  const softGet = (schema, apiPath, query) => request(schema, 'GET', apiPath, { query, soft: true })
  /**
   * @template {z.ZodType} S
   * @param {S} schema
   * @param {string} apiPath
   * @param {ProxmoxRequestFields} [form]
   * @returns {Promise<z.infer<S>>}
   */
  const post = (schema, apiPath, form) =>
    request(schema, 'POST', apiPath, { form, soft: /** @type {false} */ (false) })
  /**
   * @template {z.ZodType} S
   * @param {S} schema
   * @param {string} apiPath
   * @param {ProxmoxRequestFields} [form]
   * @returns {Promise<z.infer<S>>}
   */
  const put = (schema, apiPath, form) =>
    request(schema, 'PUT', apiPath, { form, soft: /** @type {false} */ (false) })
  // PVE rejects DELETE with a body ("Unexpected content for method DELETE") — use query only.
  /**
   * @template {z.ZodType} S
   * @param {S} schema
   * @param {string} apiPath
   * @param {ProxmoxRequestFields} [query]
   * @returns {Promise<z.infer<S>>}
   */
  const del = (schema, apiPath, query) =>
    request(schema, 'DELETE', apiPath, { query, soft: /** @type {false} */ (false) })

  /**
   * @param {string} upid
   * @param {{ timeoutSec?: number }} [opts]
   */
  async function waitTask(upid, { timeoutSec = 600 } = {}) {
    if (!upid) return null
    const deadline = Date.now() + timeoutSec * 1000
    for (;;) {
      const st = await get(
        pveTaskStatus,
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      )
      if (st.status === 'stopped') {
        if (st.exitstatus === 'OK') return st
        die(`Proxmox task failed: ${upid} exitstatus=${st.exitstatus}`)
      }
      if (Date.now() >= deadline) die(`Proxmox task timed out: ${upid}`)
      await sleep(2000)
    }
  }

  /**
   * Multipart upload to directory storage (iso / import / vztmpl).
   * Streams from disk (no full-file buffer) — important for ~600MiB qcow2.
   * @param {string} storage
   * @param {'iso'|'import'|'vztmpl'} content
   * @param {string} filePath
   * @param {{ filename?: string, timeoutSec?: number }} [opts]
   * @returns {Promise<string>}
   */
  async function upload(storage, content, filePath, opts = {}) {
    const { openAsBlob } = await import('node:fs')
    const { basename } = await import('node:path')
    const { stat } = await import('node:fs/promises')
    const filename = opts.filename || basename(filePath)
    const url = new URL(
      `/api2/json/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`,
      apiUrl,
    )
    const st = await stat(filePath)
    const fd = new FormData()
    fd.set('content', content)
    // PVE expects the file part to be named "filename" (not "file").
    const blob = await openAsBlob(filePath)
    fd.set('filename', new File([blob], filename, { type: 'application/octet-stream' }))

    console.log(
      chalk.cyan(
        `vm: uploading ${filename} (${(st.size / 1024 / 1024).toFixed(1)} MiB) → ${storage}:${content}/…`,
      ),
    )
    const t0 = Date.now()
    let res
    try {
      res = await fetch(url, { method: 'POST', headers: { ...authHeaders }, body: fd })
    } catch (err) {
      die(
        `Proxmox upload ${storage}/${content}/${filename}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      die(`Proxmox upload non-JSON (${res.status}): ${text.slice(0, 200)}`)
    }
    if (!res.ok) {
      const detail = json?.errors
        ? JSON.stringify(json.errors)
        : json?.message || text.slice(0, 300)
      die(`Proxmox upload HTTP ${res.status}: ${detail}`)
    }
    const upidParsed = pveUpid.safeParse(json?.data)
    if (!upidParsed.success) {
      die(`Proxmox upload:\n${z.prettifyError(upidParsed.error)}`)
    }
    if (upidParsed.data)
      await waitTask(String(upidParsed.data), { timeoutSec: opts.timeoutSec || 3600 })
    const sec = Math.max(0.001, (Date.now() - t0) / 1000)
    console.log(
      chalk.green(
        `vm: upload done ${(st.size / 1024 / 1024 / sec).toFixed(1)} MiB/s (${sec.toFixed(1)}s)`,
      ),
    )
    return `${storage}:${content}/${filename}`
  }

  async function version() {
    return get(pveVersion, '/version')
  }

  async function nextId() {
    return get(pveNextId, '/cluster/nextid')
  }

  /**
   * @param {number|string} vmid
   * @returns {Promise<QemuConfig>}
   */
  async function qemuConfig(vmid) {
    return get(pveQemuConfig, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`)
  }

  /**
   * @param {number|string} vmid
   */
  async function qemuStatus(vmid) {
    return get(pveQemuStatus, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`)
  }

  async function qemuList() {
    return get(pveQemuList, `/nodes/${encodeURIComponent(node)}/qemu`)
  }

  /**
   * @param {string} name
   * @returns {Promise<number | null>}
   */
  async function findVmidByName(name) {
    const list = (await qemuList()) || []
    const hit = list.find((vm) => vm.name === name)
    return hit ? Number(hit.vmid) : null
  }

  /**
   * Delete a volume: volid like `local:iso/foo.iso` or `local-lvm:vm-100-disk-0`.
   * @param {string} volid
   */
  async function deleteVolume(volid) {
    const idx = String(volid).indexOf(':')
    if (idx < 0) die(`bad volid ${volid}`)
    const storage = volid.slice(0, idx)
    const volume = volid.slice(idx + 1)
    const upid = await del(
      pveUpid,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volume)}`,
    )
    if (upid) await waitTask(String(upid), { timeoutSec: 300 })
  }

  return {
    config,
    get,
    softGet,
    post,
    put,
    del,
    upload,
    waitTask,
    version,
    nextId,
    qemuConfig,
    qemuStatus,
    qemuList,
    findVmidByName,
    deleteVolume,
  }
}

/** @typedef {ReturnType<typeof createProxmoxClient>} ProxmoxClient */
