/**
 * Hypervisor drivers: registry + resolve.
 */

// Builtin self-registration (side-effect).
import './proxmox.js'
import './workstation.js'

export { resolveDriver } from './resolve.js'
