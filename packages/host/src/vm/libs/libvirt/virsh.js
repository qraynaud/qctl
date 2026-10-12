import { $ } from 'zx'

/**
 * Returns a zx ProcessPromise so callers can chain .nothrow() before await.
 * @param {string} connect
 * @param {...string} args
 */
export function virsh(connect, ...args) {
  return $`virsh -c ${connect} ${args}`
}
