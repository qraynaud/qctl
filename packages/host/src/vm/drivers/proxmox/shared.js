/**
 * Shared Proxmox driver helpers.
 */
import { chalk } from 'zx'

import { createProxmoxClient } from '../../libs/proxmox/client.js'
import { loadProxmoxConfig } from '../../libs/proxmox/config.js'

/** @import { ProxmoxClient } from '../../libs/proxmox/client.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @param {Pick<VmArgv, 'env'>} argv
 * @returns {Promise<ProxmoxClient>}
 */
export async function clientFrom(argv) {
  return createProxmoxClient(await loadProxmoxConfig({ env: argv.env || 'dev' }))
}

/**
 * @param {Pick<VmArgv, 'env'>} argv
 * @returns {Promise<ProxmoxClient>}
 */
export async function ping(argv) {
  const client = await clientFrom(argv)
  const ver = await client.version()
  console.log(
    chalk.green(
      `vm: Proxmox OK ${client.config.apiUrl} node=${client.config.node} `
        + `version=${ver?.version || '?'}`,
    ),
  )
  return client
}
