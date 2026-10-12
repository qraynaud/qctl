/**
 * Shared virsh mock helpers for libvirt unit tests.
 * Returns are cast to ProcessPromise so spyOn(virsh) accepts them.
 */

/** @import { ProcessPromise } from 'zx' */

/**
 * @typedef {{
 *   quiet: () => MockVirsh,
 *   nothrow: () => Promise<{ exitCode: number, stdout: string, stderr: string }>,
 * }} MockVirsh
 */

/**
 * @param {number} exitCode
 * @param {string} [stdout]
 * @param {string} [stderr]
 * @returns {ProcessPromise}
 */
export function virshReply(exitCode, stdout = '', stderr = '') {
  const settled = Promise.resolve({ exitCode, stdout, stderr })
  /** @type {MockVirsh} */
  const chain = {
    quiet() {
      return chain
    },
    nothrow() {
      return settled
    },
  }
  // Mock chain only implements quiet/nothrow used by libvirt helpers.
  return /** @type {ProcessPromise} */ (/** @type {MockVirsh & ProcessPromise} */ (chain))
}

/**
 * @param {(
 *   connect: string,
 *   cmd: string,
 *   ...args: string[]
 * ) => ProcessPromise} impl
 * @returns {(connect: string, ...args: string[]) => ProcessPromise}
 */
export function routeVirsh(impl) {
  return (connect, ...args) => impl(connect, args[0] || '', ...args.slice(1))
}
