/**
 * Proxmox helpers: storage prep, cloud image, NoCloud ISO, rocky-shaped VM create.
 */

export {
  detachAndDeleteSeedIso,
  ensureCloudImageImport,
  restoreProxmoxDisplay,
  sizeToGiB,
  uploadSeedIso,
} from './vm-images.js'
export {
  createAndStartRockyVm,
  createRockyVm,
  destroyRockyVm,
  disksWithReuseVolids,
  startProxmoxVm,
  waitUntilVmStopped,
} from './vm-lifecycle.js'
export { reconcileRockyAppliance } from './vm-reconcile.js'
