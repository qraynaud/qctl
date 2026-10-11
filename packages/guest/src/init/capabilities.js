/**
 * Init-profile → platform capability names.
 * Resolved through the loaded platform's `packages` map (open vocabulary).
 */

/** @import { InitProfile } from '@qctl/shared' */

/**
 * @param {InitProfile | string} profile
 * @param {{ vcs?: string }} [opts]
 * @returns {string[]}
 */
export function capabilitiesForProfile(profile, opts = {}) {
  /** @type {string[]} */
  const base = ['curl', 'jq', 'unzip', 'zfs', 'xfsprogs']
  if (profile === 'init-tank') return base

  /** @type {string[]} */
  const appliance = [...base, 'podman', 'firewalld', 'openssh', 'qemu-guest-agent', 'cockpit']
  // hg → mercurial (needs pipx + declares pipx packages in the platform map)
  if (opts.vcs === 'hg') appliance.push('mercurial')
  else appliance.push('git')
  return appliance
}
