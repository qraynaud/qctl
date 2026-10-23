/** Proxmox (PVE API) target-check. */
import { path } from 'zx'

import { BUILTIN_ENVIRONMENTS, isEmptyCredential, isProductionEnv } from '@qctl/shared'

import { loadEnvProvisionSafe } from '../../../lib/load-config.js'
import { tankPassphraseCredName } from '../../../provision/schema/first-boot.js'
import { createCheckReport } from '../../libs/check-report.js'
import { createProxmoxClient } from '../../libs/proxmox/client.js'
import { formatNetsLabel, tryLoadProxmoxConfig } from '../../libs/proxmox/config.js'

/** @import { ProxmoxConfig } from '../../libs/proxmox/types.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @typedef {object} PveStorageEntry
 * @property {string} [storage]
 * @property {string | string[]} [content]
 * @property {number} [active]
 * @property {number} [enabled]
 */
/**
 * @typedef {object} PveNetworkEntry
 * @property {string} [iface]
 * @property {string} [name]
 * @property {string} [type]
 */

/**
 * @param {PveStorageEntry | undefined} entry
 * @returns {string[]}
 */
function contentTypes(entry) {
  const raw = entry?.content
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string')
    return raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<boolean>}
 */
export async function check(argv) {
  const report = createCheckReport('proxmox')
  const envName = String(argv.env || 'dev')

  report.section('Provision / API config')
  const { config, errors, usable } = await tryLoadProxmoxConfig({
    env: envName,
    profile: /** @type {string} */ (argv.profile),
  })
  for (const e of errors) report.fail(e)
  if (config) {
    if (config.apiUrl && /^https?:\/\//i.test(config.apiUrl)) report.ok(`apiUrl ${config.apiUrl}`)
    if (config.node) report.ok(`node ${config.node}`)
    if (config.apiToken?.includes('=')) report.ok('apiToken present (format OK)')
    report.ok(`storage ${config.storage} (VM disks)`)
    report.ok(`imageStorage ${config.imageStorage} (ISO/snippets)`)
    report.ok(formatNetsLabel(config.nets))
    if (config.vmid != null) report.ok(`fixed vmid ${config.vmid}`)
    else report.ok('vmid: cluster nextid (no proxmox.vmid)')
  }

  report.section(`Seed config (provision/, env=${envName}, target=proxmox)`)
  const loaded = await loadEnvProvisionSafe({
    env: envName,
    target: 'proxmox',
    profile: /** @type {string} */ (argv.profile),
  })
  if (!loaded.ok) {
    report.fail(loaded.error)
  } else {
    const { provision } = loaded
    report.ok(`loaded ${provision.paths.map((p) => path.basename(p)).join(' + ')}`)

    if (provision.sshAuthorizedKeys) report.ok('admin SSH key present')
    else report.warn('no ssh.authorized_keys in provision/ and no ~/.ssh id_*.pub — seed will fail')

    /** @type {string[]} */
    const expectedTankPass = []
    for (const tank of Object.values(provision.data.disks?.tanks || {})) {
      if (tank.passphrase) expectedTankPass.push(tankPassphraseCredName(tank.id))
    }
    const tier0Missing = expectedTankPass.filter((k) => isEmptyCredential(provision.guest?.[k]))
    if (expectedTankPass.length === 0) {
      report.ok('first-boot Tier-0: no encrypted tanks')
    } else if (tier0Missing.length === 0) {
      report.ok(`first-boot Tier-0 (${expectedTankPass.join(', ')}) present`)
    } else {
      report.warn(
        `missing first-boot Tier-0 ${tier0Missing.join(', ')} — set disks.tanks.*.passphrase (!env)`,
      )
    }
  }

  const production =
    argv.production
    ?? (loaded.ok
      ? isProductionEnv(envName, loaded.provision.data.qctl?.environments ?? BUILTIN_ENVIRONMENTS)
      : false)
  if (production) {
    report.section('Environment')
    report.ok(
      'attach-mode: omit disks.*.size for physical (by-id / holder serial); set size for virtual',
    )
  }

  report.section('API connectivity')
  if (!usable || !config) {
    report.fail('skipped API checks — fix Proxmox provision above')
  } else {
    const client = createProxmoxClient(/** @type {ProxmoxConfig} */ (config))
    const ver = await client.softGet('/version')
    if (!ver.ok) report.fail(ver.error)
    else report.ok(`reachable (version ${ver.data?.version || '?'})`)

    const nodes = await client.softGet('/nodes')
    if (!nodes.ok) {
      report.fail(nodes.error)
    } else {
      const list = nodes.data || []
      const hit = list.find(
        (/** @type {{ node?: string, status?: string }} */ n) => n.node === config.node,
      )
      if (hit) {
        report.ok(`node ${config.node} (status=${hit.status || '?'})`)
        if (hit.status && hit.status !== 'online') {
          report.warn(`node ${config.node} status is ${hit.status}`)
        }
      } else {
        const have = list.map((/** @type {{ node?: string }} */ n) => n.node).join(', ')
        report.fail(`node ${config.node} not in cluster (have: ${have || 'none'})`)
      }
    }

    report.section('Token privileges')
    const audit = await client.softGet(`/nodes/${encodeURIComponent(client.config.node)}/status`)
    if (!audit.ok && /403|Permission check failed/i.test(audit.error || '')) {
      report.fail(
        'token lacks Sys.Audit (and likely Datastore.*) — PVE lists storage as empty instead of 403',
      )
      report.fail(
        'fix: Datacenter → Permissions → API Tokens → rocky-deploy: uncheck Privilege Separation '
          + '(full privileges), or keep it and ACL-grant Administrator on /',
      )
    } else if (!audit.ok) {
      report.fail(`node status: ${audit.error}`)
    } else {
      report.ok('node status readable (Sys.Audit OK)')
    }

    report.section('Storage / network')
    const storages = await client.softGet(
      `/nodes/${encodeURIComponent(client.config.node)}/storage`,
    )
    if (!storages.ok) {
      report.fail(storages.error)
    } else {
      const list = storages.data || []
      if (list.length === 0) {
        report.fail(
          `storage list empty on ${config.node} — usually token ACL (see Token privileges), `
            + `or no datastores under Datacenter → Storage`,
        )
      }
      const byName = Object.fromEntries(
        list.map((/** @type {PveStorageEntry} */ s) => [s.storage, s]),
      )

      const diskSt = byName[config.storage]
      if (!diskSt) {
        const have = list.map((/** @type {PveStorageEntry} */ s) => s.storage).join(', ')
        report.fail(`storage ${config.storage} missing on ${config.node} (have: ${have || 'none'})`)
      } else {
        const types = contentTypes(diskSt)
        if (types.length === 0 || types.includes('images')) {
          report.ok(`storage ${config.storage} available (content: ${types.join(',') || '?'})`)
        } else {
          report.warn(
            `storage ${config.storage} has no "images" content (${types.join(',')}) — VM disks may fail`,
          )
        }
        if (diskSt.active === 0 || diskSt.enabled === 0) {
          report.warn(`storage ${config.storage} inactive/disabled`)
        }
      }

      const imgSt = byName[config.imageStorage]
      if (!imgSt) {
        report.fail(`imageStorage ${config.imageStorage} missing on ${config.node}`)
      } else {
        const types = contentTypes(imgSt)
        report.ok(`imageStorage ${config.imageStorage} (content: ${types.join(',') || '?'})`)
        if (!types.includes('snippets') && !types.includes('iso')) {
          report.warn(
            `${config.imageStorage} lacks snippets/iso content — cicustom / cloud image import may need enabling`,
          )
        } else if (!types.includes('snippets')) {
          report.warn(
            `${config.imageStorage} has no snippets content — enable for cicustom user-data`,
          )
        } else {
          report.ok('snippets content enabled (cicustom)')
        }
      }
    }

    const nets = await client.softGet(`/nodes/${encodeURIComponent(client.config.node)}/network`)
    if (!nets.ok) {
      report.fail(`network list: ${nets.error}`)
    } else {
      /** @type {PveNetworkEntry[]} */
      const list = nets.data || []
      const bridges = list.filter(
        (n) => n.type === 'bridge' || String(n.iface || '').startsWith('vmbr'),
      )
      const eth = list.filter((n) => n.type === 'eth' || n.type === 'OVSPort').map((n) => n.iface)
      const wanted = [...new Set((config.nets || []).map((n) => n.bridge))]
      for (const bridge of wanted) {
        const br = list.find((n) => n.iface === bridge || n.name === bridge)
        if (br) report.ok(`bridge ${bridge} present`)
        else {
          report.fail(
            `bridge ${bridge} not found (bridges: ${bridges.map((b) => b.iface).join(', ') || 'none'}; `
              + `nics: ${eth.join(', ') || 'none'})`,
          )
          report.fail(
            `host: create Linux bridge ${bridge} (System → Network), or fix proxmox.net.*.bridge in profile-*.yaml / target-proxmox.yaml`,
          )
        }
      }
    }

    const next = await client.softGet('/cluster/nextid')
    if (!next.ok) report.fail(`nextid: ${next.error}`)
    else report.ok(`cluster nextid=${next.data}`)
  }

  report.section('Create path')
  report.ok('init-tank + up: holder <name>-disks via rename/promote (disks stay attached)')
  report.ok('disk topology from provision disks: + platform defaults (attach-mode)')

  return report.finish()
}
