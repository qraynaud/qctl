/**
 * Minimal Proxmox VE JSON API client (API token auth).
 */
import { chalk } from 'zx'

import { die } from '../../../lib/util.js'

/**
 * @import {
 *   ProxmoxConfig,
 *   QemuConfig,
 *   QemuListEntry,
 *   RequestOpts,
 *   SoftResult,
 * } from './types.js'
 */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
   * JSON API call. Return type is intentionally loose — PVE payloads vary by path.
   * @param {string} method
   * @param {string} apiPath
   * @param {RequestOpts} [opts]
   * @returns {Promise<any>}
   */
  async function request(method, apiPath, { query, body, form, soft = false } = {}) {
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

    let res
    try {
      res = await fetch(url, init)
    } catch (err) {
      const msg = `Proxmox API ${method} ${url.pathname}: ${
        err instanceof Error ? err.message : String(err)
      }`
      if (soft) return /** @type {SoftResult} */ ({ ok: false, error: msg })
      die(msg)
    }

    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      const msg = `Proxmox API ${method} ${url.pathname}: non-JSON (${res.status}): ${text.slice(0, 200)}`
      if (soft) return /** @type {SoftResult} */ ({ ok: false, error: msg })
      die(msg)
    }

    if (!res.ok) {
      const detail = json?.errors
        ? JSON.stringify(json.errors)
        : json?.message || text.slice(0, 300)
      const msg = `Proxmox API ${method} ${url.pathname}: HTTP ${res.status}: ${detail}`
      if (soft) return /** @type {SoftResult} */ ({ ok: false, error: msg })
      die(msg)
    }

    if (soft) return /** @type {SoftResult} */ ({ ok: true, data: json?.data })
    return json?.data
  }

  /**
   * @param {string} apiPath
   * @param {RequestOpts['query']} [query]
   */
  const get = (apiPath, query) => request('GET', apiPath, { query })
  /**
   * @param {string} apiPath
   * @param {RequestOpts['query']} [query]
   */
  const softGet = (apiPath, query) => request('GET', apiPath, { query, soft: true })
  /**
   * @param {string} apiPath
   * @param {RequestOpts['form']} [form]
   */
  const post = (apiPath, form) => request('POST', apiPath, { form })
  /**
   * @param {string} apiPath
   * @param {RequestOpts['form']} [form]
   */
  const put = (apiPath, form) => request('PUT', apiPath, { form })
  // PVE rejects DELETE with a body ("Unexpected content for method DELETE") — use query only.
  /**
   * @param {string} apiPath
   * @param {RequestOpts['query']} [query]
   */
  const del = (apiPath, query) => request('DELETE', apiPath, { query })

  /**
   * @param {string} upid
   * @param {{ timeoutSec?: number }} [opts]
   */
  async function waitTask(upid, { timeoutSec = 600 } = {}) {
    if (!upid) return null
    const deadline = Date.now() + timeoutSec * 1000
    for (;;) {
      const st = await get(
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      )
      if (st?.status === 'stopped') {
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
    const upid = json?.data
    if (upid) await waitTask(String(upid), { timeoutSec: opts.timeoutSec || 3600 })
    const sec = Math.max(0.001, (Date.now() - t0) / 1000)
    console.log(
      chalk.green(
        `vm: upload done ${(st.size / 1024 / 1024 / sec).toFixed(1)} MiB/s (${sec.toFixed(1)}s)`,
      ),
    )
    return `${storage}:${content}/${filename}`
  }

  async function version() {
    return get('/version')
  }

  async function nextId() {
    return get('/cluster/nextid')
  }

  /**
   * @param {number|string} vmid
   * @returns {Promise<QemuConfig>}
   */
  async function qemuConfig(vmid) {
    return /** @type {Promise<QemuConfig>} */ (
      get(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`)
    )
  }

  /**
   * @param {number|string} vmid
   * @returns {Promise<any>}
   */
  async function qemuStatus(vmid) {
    return get(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`)
  }

  /** @returns {Promise<QemuListEntry[]>} */
  async function qemuList() {
    return /** @type {Promise<QemuListEntry[]>} */ (get(`/nodes/${encodeURIComponent(node)}/qemu`))
  }

  /**
   * @param {string} name
   * @returns {Promise<number | null>}
   */
  async function findVmidByName(name) {
    const list = /** @type {QemuListEntry[]} */ ((await qemuList()) || [])
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
