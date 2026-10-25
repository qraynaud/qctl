/**
 * Libvirt helpers: thin barrel. Prefer importing from here so callers stay stable
 * while implementations live in sibling modules.
 */

export { domainExists, domainState, removeDomain } from './domain.js'
export {
  attachInitTankBootDisk,
  detachInitTankBootDisk,
} from './init-tank-boot.js'
export { ensureDefaultNetwork } from './network.js'
export { reconcilePasstPortForwards } from './passt.js'
export { reconcileDomainResources } from './resources.js'
export { detachSeedCdrom } from './seed-cdrom.js'
export { setDomainSerialNull, setDomainSerialTcp } from './serial.js'
export { virsh } from './virsh.js'
