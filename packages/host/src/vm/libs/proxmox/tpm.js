/**
 * Proxmox storage-backed TPM 2.0 state volume (1 GiB allocation; PVE uses a small image).
 * @param {string} storage
 * @returns {string}
 */
export function rockyTpmstate(storage) {
  return `${storage}:1,version=v2.0`
}
