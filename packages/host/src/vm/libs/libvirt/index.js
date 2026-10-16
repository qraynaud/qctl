/**
 * Libvirt helpers: thin barrel. Prefer importing from here so callers stay stable
 * while implementations live in sibling modules.
 */

export { domainExists, domainState, removeDomain } from './domain.js'
export { ensureDefaultNetwork } from './network.js'
export { reconcilePasstPortForwards } from './passt.js'
export { reconcileDomainResources } from './resources.js'
export {
  restartWithSerialNull,
  setDomainSerialNull,
  setDomainSerialTcp,
} from './serial.js'
export { reconcileDomainTpm } from './tpm.js'
export { virsh } from './virsh.js'
