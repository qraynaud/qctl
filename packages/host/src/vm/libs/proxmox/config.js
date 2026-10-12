/**
 * Proxmox API config from provision/<env>.yaml + provision/<env>.proxmox.yaml
 */
import { loadEnvSecrets } from '../../../lib/load-config.js'
import { tryGetRepoRoot } from '../../../lib/paths.js'
import { die } from '../../../lib/util.js'

export {
  applyNetsToForm,
  formatNetsLabel,
  mergeNetPreserveMac,
} from './net.js'

/**
 * @param {{ env?: string }} [opts]
 */
export async function loadProxmoxConfig(opts = {}) {
  const env = opts.env || 'dev'
  const sec = await loadEnvSecrets({ env, target: 'proxmox' })
  const pve = sec.proxmox || {}

  const apiUrl = String(pve.api_url || '').replace(/\/+$/, '')
  const apiToken = pve.api_token != null ? String(pve.api_token).trim() : ''
  const node = pve.node != null ? String(pve.node).trim() : ''

  if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
    die(`proxmox.api_url missing/invalid in ${sec.path} (got ${JSON.stringify(pve.api_url || '')})`)
  }
  if (!apiToken.includes('=')) {
    die(
      'proxmox.api_token must look like <user>@<realm>!<token_id>=<secret> '
        + `(full value from the Proxmox UI) — see ${sec.path}`,
    )
  }
  if (!node) die(`proxmox.node missing in ${sec.path}`)

  const storage = (pve.storage != null && String(pve.storage).trim()) || 'local-lvm'
  const imageStorage = (pve.image_storage != null && String(pve.image_storage).trim()) || 'local'

  let vmid = null
  if (pve.vmid != null && String(pve.vmid).trim() !== '') {
    vmid = Number(pve.vmid)
    if (!Number.isInteger(vmid) || vmid < 100) {
      die(`proxmox.vmid must be an integer ≥ 100 (got ${pve.vmid})`)
    }
  }

  const nets = sec.nets
  const primary = nets[0] || { bridge: 'vmbr0', vlan: null, trunks: null, mac: null }

  return {
    provisionDir: sec.provisionDir,
    env,
    secretsPath: sec.path,
    apiUrl,
    apiToken,
    node,
    storage,
    imageStorage,
    nets,
    bridge: primary.bridge,
    vlan: primary.vlan,
    trunks: primary.trunks,
    mac: primary.mac,
    vmid,
  }
}

/**
 * Soft load for target-check.
 * @param {{ env?: string }} [opts]
 */
export async function tryLoadProxmoxConfig(opts = {}) {
  const env = opts.env || 'dev'
  const errors = []

  if (!tryGetRepoRoot()) {
    return {
      config: null,
      errors: ['not inside a qctl instance repo (run from a dir with provision/*.yaml + qctl:)'],
      usable: false,
    }
  }

  let sec
  try {
    sec = await loadEnvSecrets({ env, target: 'proxmox' })
  } catch (err) {
    return {
      config: null,
      errors: [err instanceof Error ? err.message : String(err)],
      usable: false,
    }
  }

  const pve = sec.proxmox || {}
  const apiUrl = String(pve.api_url || '').replace(/\/+$/, '')
  const apiToken = pve.api_token != null ? String(pve.api_token).trim() : ''
  const node = pve.node != null ? String(pve.node).trim() : ''

  if (!apiUrl) errors.push(`proxmox.api_url missing in ${sec.path}`)
  else if (!/^https?:\/\//i.test(apiUrl)) {
    errors.push(`proxmox.api_url must be http(s) (got ${JSON.stringify(apiUrl)})`)
  }
  if (!apiToken) errors.push(`proxmox.api_token missing in ${sec.path}`)
  else if (!apiToken.includes('=')) {
    errors.push('proxmox.api_token must look like <user>@<realm>!<token_id>=<secret>')
  }
  if (!node) errors.push(`proxmox.node missing in ${sec.path}`)

  let vmid = null
  if (pve.vmid != null && String(pve.vmid).trim() !== '') {
    vmid = Number(pve.vmid)
    if (!Number.isInteger(vmid) || vmid < 100) {
      errors.push(`proxmox.vmid must be an integer ≥ 100 (got ${pve.vmid})`)
      vmid = null
    }
  }

  const nets = sec.nets
  const primary = nets[0] || { bridge: 'vmbr0', vlan: null, trunks: null, mac: null }
  const config = {
    provisionDir: sec.provisionDir,
    env,
    secretsPath: sec.path,
    apiUrl: apiUrl || null,
    apiToken: apiToken || null,
    node: node || null,
    storage: (pve.storage && String(pve.storage).trim()) || 'local-lvm',
    imageStorage: (pve.image_storage && String(pve.image_storage).trim()) || 'local',
    nets,
    bridge: primary.bridge,
    vlan: primary.vlan,
    trunks: primary.trunks,
    mac: primary.mac,
    vmid,
  }

  const usable =
    errors.length === 0
    && Boolean(apiUrl && /^https?:\/\//i.test(apiUrl) && apiToken?.includes('=') && node)

  return { config, errors, usable }
}
