/**
 * Proxmox API config from provision layers (target-proxmox + profile-* last).
 */
import { loadEnvProvision, loadEnvProvisionSafe } from '../../../lib/load-config.js'
import { tryGetRepoRoot } from '../../../lib/paths.js'
import { die } from '../../../lib/util.js'

export {
  applyNetsToForm,
  formatNetsLabel,
  mergeNetPreserveMac,
} from './net.js'

/**
 * @param {{ env?: string, profile?: string }} [opts]
 */
export async function loadProxmoxConfig(opts = {}) {
  const env = opts.env || 'dev'
  const profile = opts.profile || 'lab'
  const sec = await loadEnvProvision({ env, target: 'proxmox', profile })
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

  const nets = sec.nets
  const primary = nets[0] || { bridge: 'vmbr0' }

  return {
    provisionDir: sec.provisionDir,
    env,
    provisionPath: sec.path,
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
    vmid: pve.vmid,
  }
}

/**
 * Soft load for target-check.
 * @param {{ env?: string, profile?: string }} [opts]
 */
export async function tryLoadProxmoxConfig(opts = {}) {
  const env = opts.env || 'dev'
  const profile = opts.profile || 'lab'
  /** @type {string[]} */
  const errors = []

  if (!tryGetRepoRoot()) {
    return {
      config: null,
      errors: ['not inside a qctl instance repo (run from a dir with provision/*.yaml + qctl:)'],
      usable: false,
    }
  }

  const loaded = await loadEnvProvisionSafe({ env, target: 'proxmox', profile })
  if (!loaded.ok) {
    return { config: null, errors: [loaded.error], usable: false }
  }
  const sec = loaded.provision

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

  const nets = sec.nets
  const primary = nets[0] || { bridge: 'vmbr0' }
  const config = {
    provisionDir: sec.provisionDir,
    env,
    provisionPath: sec.path,
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
    vmid: pve.vmid,
  }

  const usable =
    errors.length === 0
    && Boolean(apiUrl && /^https?:\/\//i.test(apiUrl) && apiToken?.includes('=') && node)

  return { config, errors, usable }
}
